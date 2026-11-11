import { EventBus } from '@core/events/EventBus';
import { ServiceContainer, createToken } from '@core/di/ServiceContainer';
import { GameLoop } from '@engine/loop/GameLoop';
import { Viewport, type QualityTier } from '@engine/platform/Viewport';
import { RendererService } from '@engine/render/RendererService';
import { InputManager } from '@engine/input/InputManager';
import { AudioManager } from '@engine/audio/AudioManager';
import { AssetManager } from '@engine/assets/AssetManager';
import { SoundBoard } from '@game/audio/SoundBoard';
import { SaveManager } from '@engine/save/SaveManager';
import { SettingsManager } from '@engine/settings/SettingsManager';
import { UIManager } from '@ui/UIManager';
import { PauseScreen } from '@ui/screens/PauseScreen';
import { PlanetScene } from '@game/scenes/PlanetScene';
import { Hud, type Objective } from '@ui/hud/Hud';
import { TouchControls } from '@ui/hud/TouchControls';
import { DialogueOverlay } from '@ui/screens/DialogueOverlay';
import { RouteReportScreen } from '@ui/screens/RouteReportScreen';
import { JournalScreen, type JournalView } from '@ui/screens/JournalScreen';
import { IntroScreen } from '@ui/screens/IntroScreen';
import { GameStateManager } from '@game/state/GameStateManager';
import { DebugOverlay } from '@game/debug/DebugOverlay';
import { DISTRICTS, CONTRACTS, npcById } from './data/content';
import { COURSES, POSTCARDS, SOUVENIRS, STAMPS } from './data/activities';
import { MainMenuScreen } from '@ui/screens/MainMenuScreen';
import { SettingsScreen } from '@ui/screens/SettingsScreen';
import { t, setLocale } from '@engine/i18n/Localization';
import type { CharacterDefinition } from '@engine/character/CharacterDefinition';

export const Tokens = {
  bus: createToken<EventBus>('EventBus'),
  viewport: createToken<Viewport>('Viewport'),
  renderer: createToken<RendererService>('RendererService'),
  input: createToken<InputManager>('InputManager'),
  audio: createToken<AudioManager>('AudioManager'),
  save: createToken<SaveManager>('SaveManager'),
  settings: createToken<SettingsManager>('SettingsManager'),
  ui: createToken<UIManager>('UIManager'),
};

const boot = document.getElementById('boot');
const bootBar = document.getElementById('boot-bar');
const bootMsg = document.getElementById('boot-msg');

/** Postcard pictures live beside the save, not in it: they are large and can be lost without harm. */
const ALBUM_KEY = 'lumenpost.postcards';

function setProgress(fraction: number, message?: string): void {
  if (bootBar) bootBar.style.width = `${Math.round(fraction * 100)}%`;
  if (message && bootMsg) bootMsg.textContent = message;
}

function fail(message: string, detail?: unknown): void {
  console.error(message, detail);
  if (bootMsg) bootMsg.textContent = message;
  if (bootBar) bootBar.style.background = '#c8402f';
}

function loadAlbum(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(ALBUM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function storeAlbum(album: Record<string, string>): void {
  try {
    window.localStorage.setItem(ALBUM_KEY, JSON.stringify(album));
  } catch {
    // Storage full or unavailable: the journal entry stands, the picture does not.
  }
}

/** Everything the screens need, in one bag, so the wiring functions stay readable. */
interface Game {
  bus: EventBus;
  ui: UIManager;
  settings: SettingsManager;
  save: SaveManager;
  scene: PlanetScene;
  state: GameStateManager;
  hud: Hud;
  audio: AudioManager;
  input: InputManager;
  album: Record<string, string>;
  runClock: { startedAt: number };
}

/**
 * Composition root.
 *
 * Builds the container, wires the subsystems, and starts the loop. Every
 * dependency is passed explicitly — nothing reaches for a global.
 */
async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  if (!canvas || !uiRoot) return fail('Could not find the game canvas.');

  // Fail early and legibly rather than throwing a WebGL error into the console.
  if (!canvas.getContext('webgl2')) {
    return fail(t('error.webgl'));
  }

  const container = new ServiceContainer();
  const bus = new EventBus();
  container.registerValue(Tokens.bus, bus);

  const state = new GameStateManager(bus);
  state.send('engineReady');

  const save = new SaveManager(bus);
  const settings = new SettingsManager(save, bus);
  container.registerValue(Tokens.save, save);
  container.registerValue(Tokens.settings, settings);

  // `?quality=low|medium|high` in the address wins, then a saved choice, then
  // the guess from the hardware.
  const viewport = new Viewport(bus, chosenQuality(settings.get().qualityTier));
  viewport.attach();
  container.registerValue(Tokens.viewport, viewport);
  setProgress(0.2, t('loading.shaping'));

  const renderer = new RendererService(canvas, viewport, bus);
  container.registerValue(Tokens.renderer, renderer);

  const input = new InputManager(canvas, bus);
  input.attach();
  container.registerValue(Tokens.input, input);

  const audio = new AudioManager();
  container.registerValue(Tokens.audio, audio);
  applyAudioSettings(audio, settings);
  for (const key of ['masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume'] as const) {
    settings.observe(key, () => applyAudioSettings(audio, settings));
  }

  // Audio assets load in the background: the game is fully playable before
  // they arrive, and SoundBoard tolerates every buffer being absent.
  const assets = new AssetManager(bus);
  assets.setAudioContext(audio.context);
  const soundBoard = new SoundBoard(bus, audio, assets);

  setLocale(settings.get().language);

  const ui = new UIManager(uiRoot, bus);
  ui.setUiScale(settings.get().uiScale);
  settings.observe('uiScale', (scale) => ui.setUiScale(scale));
  container.registerValue(Tokens.ui, ui);
  setProgress(0.5);

  // Terrain generation and the BVH build are synchronous and take a few hundred
  // milliseconds; yield first so the progress bar actually paints.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const scene = new PlanetScene(renderer, input, bus, audio.music);
  await scene.onEnter();
  setProgress(0.85, t('loading.waking'));

  await attachCharacter(scene);
  scene.restoreProgress(save.get().progress);

  const hud = new Hud(ui.hud, bus);
  const touch = new TouchControls(ui.hud, input, bus);
  const dialogueOverlay = new DialogueOverlay(ui.hud, bus);
  hud.setJournal(scene.journal.points, scene.journal.total, scene.journal.rank.title);

  // Settings that change how the game is played, applied live.
  const applyPlaySettings = (): void => {
    const s = settings.get();
    const reduce = settings.prefersReducedMotion;
    input.setAlwaysRun(s.alwaysRun);
    scene.rig.setLookOptions({ sensitivity: s.cameraSensitivity, invertY: s.invertY, reduceMotion: reduce });
    ui.setReduceMotion(reduce);
    dialogueOverlay.setInstant(reduce);
  };
  applyPlaySettings();
  for (const key of ['alwaysRun', 'cameraSensitivity', 'invertY', 'reduceMotion'] as const) {
    settings.observe(key, applyPlaySettings);
  }

  const game: Game = {
    bus,
    ui,
    settings,
    save,
    scene,
    state,
    hud,
    audio,
    input,
    album: loadAlbum(),
    runClock: { startedAt: performance.now() },
  };

  wireGameplay(game);
  setProgress(1, t('loading.ready'));

  state.send('assetsReady');

  // Open on the menu with the planet turning behind it, rather than dropping
  // the player straight into a run with no context.
  scene.setMenuMode(true);
  hud.setVisible(false);
  wireMenuFlow(game);
  wirePauseFlow(game);
  showMainMenu(game);

  void loadAudio(assets, soundBoard, save);

  const debug =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')
      ? new DebugOverlay(document.body)
      : null;

  const loop = new GameLoop({
    beginFrame: (dt) => input.beginFrame(dt),
    fixedUpdate: (dt) => scene.fixedUpdate(dt),
    interpolate: (alpha) => scene.interpolate(alpha),
    update: (dt) => {
      scene.update(dt);
      dialogueOverlay.update(dt);
      hud.setObjective(objectiveFor(scene));
      hud.setMinimapData(scene.minimapMarkers, scene.illuminationFraction);
      hud.update(dt, scene.player.object3D.position, scene.cameraForward);
      touch.update();
      soundBoard.updateListener(renderer.camera);
      ui.update(dt);
      renderer.updateAdaptiveResolution(loop.fps, dt);
      debug?.update(dt, loop, scene.controller, scene.player.object3D.position);
    },
    lateUpdate: (dt) => scene.lateUpdate(dt),
    render: () => scene.render(),
    endFrame: () => input.endFrame(),
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.stop();
      audio.duck(0);
    } else {
      loop.start();
      applyAudioSettings(audio, settings);
    }
  });

  bus.on('engine:contextLost', () => {
    loop.stop();
    if (bootMsg) bootMsg.textContent = 'Restoring graphics…';
    boot?.classList.remove('gone');
  });
  bus.on('engine:contextRestored', () => {
    boot?.classList.add('gone');
    loop.start();
  });

  loop.start();
  bus.emit('engine:ready');

  boot?.classList.add('gone');
  window.setTimeout(() => boot?.remove(), 600);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lumenpost = {
      container,
      scene,
      loop,
      bus,
      state,
      save,
      settings,
      ui,
      audio,
      assets,
      soundBoard,
    };
  }
}

/** What the HUD should say the player is doing right now. */
function objectiveFor(scene: PlanetScene): Objective | null {
  if (scene.isMenuMode) return null;
  const target = scene.objectiveTarget;
  if (!target) {
    return { title: t('objective.done.title'), hint: t('objective.done.hint'), position: null };
  }
  if (target.kind === 'course') {
    return { title: COURSES[0]?.name ?? '', hint: t('objective.course.hint'), position: target.position };
  }
  if (target.kind === 'deliver') {
    return { title: target.title, hint: target.hint, position: target.position };
  }
  const first = scene.quests.completedCount === 0;
  return {
    title: t(first ? 'objective.first.title' : 'objective.next.title'),
    hint: t(first ? 'objective.first.hint' : 'objective.next.hint'),
    position: target.position,
  };
}

/**
 * Fetch and register the soundtrack.
 *
 * Deliberately not awaited during boot: ~1.4 MB of audio must never stand
 * between a click and being able to walk. The music starts the moment the
 * buffers land, and the browser's autoplay policy is satisfied by the first
 * input the player makes anyway.
 */
async function loadAudio(assets: AssetManager, soundBoard: SoundBoard, save: SaveManager): Promise<void> {
  try {
    await assets.loadManifest(`${import.meta.env.BASE_URL}assets/manifest.json`);
    await Promise.all([
      assets.acquire('audio_sfx'),
      assets.acquire('audio_music'),
      assets.acquire('audio_ambience'),
    ]);
    soundBoard.startMusic(save.get().progress.litDistricts);
    soundBoard.startAmbience();
  } catch (error) {
    // Silence is a degraded experience, not a broken one.
    console.warn('[Audio] running without sound', error);
  }
}

/** Push the main menu, with Settings reachable from it. */
function showMainMenu(game: Game): void {
  const { bus, ui, settings, save, scene } = game;
  const completed = save.get().progress.completedContracts.length;
  const journal = scene.journal;
  ui.popAll();
  ui.push(
    new MainMenuScreen(
      bus,
      {
        completed,
        total: CONTRACTS.length,
        hasProgress: completed > 0 || journal.points > 0,
        journal: journal.points,
        journalTotal: journal.total,
      },
      () => {
        ui.push(
          new SettingsScreen(bus, settings, () => ui.pop(), () => {
            // Reset wipes the save and the live world together, so the menu the
            // player returns to matches what is actually stored.
            resetEverything(game);
            ui.pop();
            showMainMenu(game);
          }),
        );
      },
    ),
  );
}

function resetEverything(game: Game): void {
  game.save.reset();
  game.scene.resetRun();
  game.album = {};
  storeAlbum(game.album);
  game.hud.setJournal(game.scene.journal.points, game.scene.journal.total, game.scene.journal.rank.title);
}

/** Start and quit, both behind the iris wipe. */
function wireMenuFlow(game: Game): void {
  const { bus, ui, save, scene, state, hud, audio, runClock } = game;

  bus.on('ui:requestStart', ({ newRun }) => {
    // The iris closes over the menu, the world changes behind it, and it opens
    // on the surface — so the cut from orbit to ground is never seen.
    void ui.transitions.wrap(() => {
      if (newRun) resetEverything(game);
      ui.popAll();
      state.send('startRun');
      state.send('worldReady');
      scene.setMenuMode(false);
      hud.setVisible(true);
      runClock.startedAt = performance.now();
      audio.ambience.setDistrict(scene.currentDistrictId, 1.2);

      // The story's first page, once per run.
      if (!scene.journal.introSeen) {
        scene.setPaused(true);
        hud.setVisible(false);
        ui.push(
          new IntroScreen(() => {
            scene.journal.markIntroSeen();
            ui.popAll();
            hud.setVisible(true);
            scene.setPaused(false);
          }),
        );
      }
    });
  });

  bus.on('ui:requestQuit', () => {
    void ui.transitions.wrap(() => {
      save.flush();
      // The menu sits in orbit, so the world's ambience has no business
      // playing over it.
      audio.ambience.silence();
      scene.setPhotoMode(false);
      scene.setMenuMode(true);
      hud.setVisible(false);
      showMainMenu(game);
    });
  });
}

function applyAudioSettings(audio: AudioManager, settings: SettingsManager): void {
  const s = settings.get();
  audio.setMasterVolume(s.masterVolume);
  audio.setBusVolume('music', s.musicVolume);
  audio.setBusVolume('sfx', s.sfxVolume);
  audio.setBusVolume('ambience', s.ambienceVolume);
}

/**
 * Load the supplied character art.
 *
 * A failure here is never fatal: the placeholder rig stays in place and the
 * game remains playable, which is the whole reason the placeholder exists.
 */
async function attachCharacter(scene: PlanetScene): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const manifest = await import('./data/characters/heroine.character.json')
    .then((module) => module.default as unknown as CharacterDefinition)
    .catch(() => null);

  // The courier: the VRoid model (hand-built hair, face and glasses) dressed
  // as on her character sheet, moving with captured motion. The clips were
  // recorded for the Meshy heroine's skeleton (docs/26) and are retargeted
  // onto the VRM's humanoid rig at load (docs/27), mapped through the same
  // manifest. Without them she still walks on the generated gait.
  try {
    const { VrmCharacter } = await import('@game/entities/VrmCharacter');
    const motion = manifest?.clips
      ? {
          url: `${base}assets/characters/heroine-motion.glb`,
          clips: manifest.clips,
          ...(manifest.fallback ? { fallback: manifest.fallback } : {}),
        }
      : undefined;
    const vrm = await VrmCharacter.load(`${base}assets/characters/aria.vrm`, 'Aria Chen', motion);
    if (vrm) {
      scene.setCharacter(vrm, vrm.height);
      return;
    }
  } catch (error) {
    console.warn('[Character] VRM unavailable; trying the generated heroine', error);
  }

  // Otherwise the heroine Meshy generated from the sheet, with the same
  // clips on her own skeleton.
  try {
    if (manifest) {
      const { loadCharacter } = await import('@engine/character/CharacterFactory');
      scene.setCharacter(await loadCharacter(manifest, base), manifest.height);
      return;
    }
  } catch (error) {
    console.warn('[Character] heroine unavailable; using the procedural rig', error);
  }

  try {
    // The procedural fallback: a real 3D rig assembled from the concept sheet's
    // specification. Still the right answer when no authored model is supplied.
    const { CourierAnimator } = await import('@game/entities/CourierAnimator');
    scene.setCharacter(new CourierAnimator());
  } catch (error) {
    console.warn('[Character] falling back to the placeholder rig', error);
  }
}

/** The journal as the screen draws it. */
function journalView(game: Game): JournalView {
  const { scene, album } = game;
  const journal = scene.journal;
  const next = journal.nextRank;

  const story = CONTRACTS.map((contract) => {
    const record = scene.quests.get(contract.id);
    const district = DISTRICTS.find((d) => d.id === contract.district)?.displayName ?? contract.district;
    const recipient = npcById(contract.recipient)?.displayName ?? contract.recipient;
    const state = record?.state ?? 'locked';
    if (state === 'completed') {
      return {
        title: contract.title,
        detail: `Delivered to ${recipient}. ${district} is lit.`,
        state: 'done' as const,
        tag: record?.rating ? t(`rating.${record.rating}`) : '',
      };
    }
    if (state === 'accepted' || state === 'carrying') {
      return { title: contract.title, detail: contract.hint, state: 'now' as const, tag: 'Carrying' };
    }
    if (state === 'available') {
      return { title: contract.title, detail: 'Postmaster Odd has this parcel ready.', state: 'now' as const, tag: 'Next' };
    }
    return { title: `A parcel for ${district}`, detail: 'After the one before it.', state: 'later' as const };
  });

  return {
    rank: journal.rank.title,
    points: journal.points,
    total: journal.total,
    next: next ? { title: next.title, need: next.at - journal.points, reward: next.reward?.name ?? null } : null,
    story,
    stamps: STAMPS.map((stamp) => ({
      title: stamp.name,
      note: stamp.note,
      hint: stamp.hint,
      seal: stamp.seal,
      found: journal.has('stamp', stamp.id),
    })),
    souvenirs: SOUVENIRS.map((item) => ({
      title: item.name,
      note: item.note,
      hint: item.hint,
      found: journal.has('souvenir', item.id),
    })),
    postcards: POSTCARDS.map((card) => ({
      title: card.title,
      note: 'In the album.',
      hint: card.brief,
      found: journal.has('postcard', card.id),
      image: album[card.id] ?? null,
    })),
    feats: [
      ...COURSES.map((course) => {
        const best = journal.courseBest(course.id);
        const medal = journal.medal(course.id);
        return {
          title: course.name,
          note: `Best ${best?.toFixed(1) ?? '—'} s${medal ? ` · ${medal} medal` : ''}. Gold is ${course.gold} s.`,
          hint: `Ring the bell east of the post office and light every lantern. Bronze is ${course.bronze} s.`,
          found: medal !== null,
        };
      }),
      {
        title: 'Friend of cats',
        note: `${journal.count('cat')} cat${journal.count('cat') === 1 ? ' has' : 's have'} decided you are acceptable.`,
        hint: 'Pet a cat twice and it will remember you.',
        found: journal.count('cat') > 0,
      },
      {
        title: 'Lumen shards',
        note: `${scene.shards.collected} of ${scene.shards.total} gathered.`,
        hint: 'Small lights lying about the planet. Walk through one.',
        found: scene.shards.collected > 0,
      },
    ],
  };
}

function wirePauseFlow(game: Game): void {
  const { bus, ui, settings, scene, state, audio, runClock, hud } = game;

  const pauseScreen = new PauseScreen(bus, settings, () => ({
    elapsedSeconds: (performance.now() - runClock.startedAt) / 1000,
    delivered: scene.quests.completedCount,
    deliveries: CONTRACTS.length,
    shards: scene.shards.collected,
    shardTotal: scene.shards.total,
    journal: scene.journal.points,
    journalTotal: scene.journal.total,
    rank: scene.journal.rank.title,
  }));

  const pause = () => {
    if (scene.isMenuMode) return;
    if (!state.send('pause')) return;
    scene.setPhotoMode(false);
    scene.setPaused(true);
    ui.setHudVisible(false);
    ui.push(pauseScreen);
    audio.duck(0.25);
  };

  const resume = () => {
    // The festival card holds her still without stopping the world.
    const fromReport = state.current === 'complete';
    if (!state.send('resume')) return;
    if (fromReport) scene.setPlayerLocked(false);
    ui.popAll();
    ui.setHudVisible(true);
    hud.setVisible(true);
    scene.setPaused(false);
    applyAudioSettings(audio, settings);
  };

  bus.on('ui:requestPause', pause);
  bus.on('ui:requestResume', resume);
  // Quitting is handled by wireMenuFlow; here we only leave the paused state.
  bus.on('ui:requestQuit', () => {
    if (state.current === 'paused') state.send('resume');
    scene.setPaused(false);
    applyAudioSettings(audio, settings);
  });

  // The journal opens over the game or over the pause menu, and closes back
  // to whichever it came from.
  bus.on('ui:requestJournal', () => {
    if (scene.isMenuMode || ui.top?.id === 'journal' || ui.top?.id === 'intro') return;
    const fromPause = state.current === 'paused';
    if (!fromPause) {
      if (!state.send('pause')) return;
      scene.setPhotoMode(false);
      scene.setPaused(true);
      ui.setHudVisible(false);
      audio.duck(0.5);
    }
    ui.push(
      new JournalScreen(journalView(game), () => {
        ui.pop();
        if (!fromPause) resume();
      }),
    );
  });

  // Escape is owned entirely by UIManager: with no screen open it emits
  // `ui:requestPause`, and with the pause screen open PauseScreen.onBack emits
  // `ui:requestResume`. Adding a second window listener here would fire on the
  // *same* keydown after the first had already popped the screen, see depth 0,
  // and immediately re-pause — so the menu could never be dismissed.
}

bootstrap().catch((error) => fail(t('error.boot'), error));

/**
 * Gameplay-to-UI wiring.
 *
 * Everything here is a subscription: the systems announce what happened and the
 * UI reacts. Nothing in this function reaches into gameplay state to mutate it,
 * which is what keeps the UI swappable (docs/10-ui-flow.md §10.3).
 */
function wireGameplay(game: Game): void {
  const { bus, ui, scene, save, hud, state } = game;

  bus.on('ui:requestDialogueAdvance', () => scene.dialogue.advance());

  bus.on('district:lit', ({ district, litCount }) => {
    // Districts are identified by id on the bus; the player sees the name.
    const name = DISTRICTS.find((d) => d.id === district)?.displayName ?? district;
    ui.showToast(t('toast.districtLit', { name, count: litCount, total: DISTRICTS.length }));
    save.update((draft) => {
      if (!draft.progress.litDistricts.includes(district)) draft.progress.litDistricts.push(district);
    });
  });

  bus.on('shard:collected', ({ id, total, of }) => {
    ui.showToast(t('toast.shard', { count: total, total: of }), 2200, 'shard');
    save.update((draft) => {
      if (!draft.progress.collectedShards.includes(id)) draft.progress.collectedShards.push(id);
    });
  });

  bus.on('delivery:completed', ({ contractId, rating }) => {
    save.update((draft) => {
      if (!draft.progress.completedContracts.includes(contractId)) {
        draft.progress.completedContracts.push(contractId);
      }
      draft.stats.deliveriesMade++;
    });
    ui.showToast(t('toast.delivered', { rating: t(`rating.${rating}`) }));
  });

  // The journal is saved whenever it changes.
  bus.on('journal:changed', () => {
    const snapshot = scene.journal.snapshot();
    save.update((draft) => {
      draft.progress.journal = snapshot;
    });
  });

  bus.on('photo:developed', ({ id, image }) => {
    game.album[id] = image;
    storeAlbum(game.album);
  });

  bus.on('course:started', () => ui.showToast(t('toast.courseStart'), 2600));
  bus.on('course:abandoned', () => ui.showToast(t('toast.courseLost'), 3200));
  bus.on('cat:petted', ({ friend }) => {
    if (friend) ui.showToast(t('toast.catFriend'), 2600);
  });

  bus.on('run:completed', ({ seconds, ratings, districtsLit }) => {
    const best = save.get().stats.bestRunSeconds;
    save.update((draft) => {
      draft.stats.runsCompleted++;
      if (best === null || seconds < best) draft.stats.bestRunSeconds = seconds;
    });
    bus.emit('festival:started');

    // Let the last district catch and the first fireworks go up before the
    // card comes down over them.
    window.setTimeout(() => {
      if (scene.isMenuMode || state.current !== 'playing') return;
      state.send('finalDelivery');
      // The world goes on — the fireworks are the point — but she stands still.
      scene.setPhotoMode(false);
      scene.setPlayerLocked(true);
      hud.setVisible(false);
      ui.push(
        new RouteReportScreen(bus, {
          seconds,
          ratings,
          shards: scene.shards.collected,
          shardTotal: scene.shards.total,
          districtsLit,
          districtTotal: DISTRICTS.length,
          bestSeconds: best,
          rank: scene.journal.rank.title,
          journal: scene.journal.points,
          journalTotal: scene.journal.total,
        }),
      );
    }, 4200);
  });
}

function chosenQuality(saved: 'auto' | QualityTier): QualityTier | undefined {
  const asked = new URLSearchParams(window.location.search).get('quality');
  if (asked === 'low' || asked === 'medium' || asked === 'high') return asked;
  return saved === 'auto' ? undefined : saved;
}
