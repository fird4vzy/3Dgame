import { EventBus } from '@core/events/EventBus';
import { ServiceContainer, createToken } from '@core/di/ServiceContainer';
import { GameLoop } from '@engine/loop/GameLoop';
import { Viewport } from '@engine/platform/Viewport';
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
import { Hud } from '@ui/hud/Hud';
import { DialogueOverlay } from '@ui/screens/DialogueOverlay';
import { RouteReportScreen } from '@ui/screens/RouteReportScreen';
import { GameStateManager } from '@game/state/GameStateManager';
import { DebugOverlay } from '@game/debug/DebugOverlay';
import { DISTRICTS, CONTRACTS } from './data/content';
import { MainMenuScreen } from '@ui/screens/MainMenuScreen';
import { SettingsScreen } from '@ui/screens/SettingsScreen';
import { t, setLocale } from '@engine/i18n/Localization';

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

function setProgress(fraction: number, message?: string): void {
  if (bootBar) bootBar.style.width = `${Math.round(fraction * 100)}%`;
  if (message && bootMsg) bootMsg.textContent = message;
}

function fail(message: string, detail?: unknown): void {
  console.error(message, detail);
  if (bootMsg) bootMsg.textContent = message;
  if (bootBar) bootBar.style.background = '#c8582f';
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

  const viewport = new Viewport(bus);
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
  settings.observe('masterVolume', () => applyAudioSettings(audio, settings));
  settings.observe('musicVolume', () => applyAudioSettings(audio, settings));
  settings.observe('sfxVolume', () => applyAudioSettings(audio, settings));

  // Audio assets load in the background: the game is fully playable before
  // they arrive, and SoundBoard tolerates every buffer being absent.
  const assets = new AssetManager(bus);
  assets.setAudioContext(audio.context);
  const soundBoard = new SoundBoard(bus, audio, assets);

  setLocale(settings.get().language);

  const ui = new UIManager(uiRoot, bus);
  ui.setUiScale(settings.get().uiScale);
  settings.observe('uiScale', (scale) => ui.setUiScale(scale));
  ui.transitions.setReduceMotion(settings.prefersReducedMotion);
  settings.observe('reduceMotion', () =>
    ui.transitions.setReduceMotion(settings.prefersReducedMotion),
  );
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
  const dialogueOverlay = new DialogueOverlay(ui.hud, bus);
  wireGameplay(bus, ui, scene, save, hud);
  setProgress(1, t('loading.ready'));

  state.send('assetsReady');

  // Open on the menu with the planet turning behind it, rather than dropping
  // the player straight into a run with no context.
  scene.setMenuMode(true);
  hud.setVisible(false);
  const runClock = { startedAt: performance.now() };
  wireMenuFlow(bus, ui, settings, scene, state, save, hud, runClock, audio);
  wirePauseFlow(bus, ui, settings, scene, state, audio, runClock);
  showMainMenu(bus, ui, settings, save, () => scene.resetRun());

  void loadAudio(assets, soundBoard, save);

  const debug = import.meta.env.DEV ? new DebugOverlay(document.body) : null;

  const loop = new GameLoop({
    beginFrame: () => input.beginFrame(1 / 60),
    fixedUpdate: (dt) => scene.fixedUpdate(dt),
    update: (dt) => {
      scene.update(dt);
      dialogueOverlay.update(dt);
      const objective = scene.objectiveTarget;
      hud.setTarget(objective?.position ?? null, objective?.hint);
      hud.update(dt, scene.player.object3D.position, scene.cameraForward);
      soundBoard.updateListener(renderer.camera);
      ui.update(dt);
      renderer.updateAdaptiveResolution(loop.fps, dt);
      debug?.update(dt, loop, scene.controller, scene.player.object3D.position);
    },
    interpolate: (alpha) => scene.interpolate(alpha),
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

/**
 * Fetch and register the soundtrack.
 *
 * Deliberately not awaited during boot: ~1.4 MB of audio must never stand
 * between a click and being able to walk. The music starts the moment the
 * buffers land, and the browser's autoplay policy is satisfied by the first
 * input the player makes anyway.
 */
async function loadAudio(
  assets: AssetManager,
  soundBoard: SoundBoard,
  save: SaveManager,
): Promise<void> {
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
function showMainMenu(
  bus: EventBus,
  ui: UIManager,
  settings: SettingsManager,
  save: SaveManager,
  onResetProgress: () => void,
): void {
  const completed = save.get().progress.completedContracts.length;
  ui.popAll();
  ui.push(
    new MainMenuScreen(
      bus,
      { completed, total: CONTRACTS.length, hasProgress: completed > 0 },
      () => {
        ui.push(
          new SettingsScreen(bus, settings, () => ui.pop(), () => {
            // Reset wipes the save and the live world together, so the menu the
            // player returns to matches what is actually stored.
            save.reset();
            onResetProgress();
            ui.pop();
            showMainMenu(bus, ui, settings, save, onResetProgress);
          }),
        );
      },
    ),
  );
}

/** Start and quit, both behind the iris wipe. */
function wireMenuFlow(
  bus: EventBus,
  ui: UIManager,
  settings: SettingsManager,
  scene: PlanetScene,
  state: GameStateManager,
  save: SaveManager,
  hud: Hud,
  runClock: { startedAt: number },
  audio: AudioManager,
): void {
  bus.on('ui:requestStart', ({ newRun }) => {
    // The iris closes over the menu, the world changes behind it, and it opens
    // on the surface — so the cut from orbit to ground is never seen.
    void ui.transitions.wrap(() => {
      if (newRun) {
        save.reset();
        scene.resetRun();
      }
      ui.popAll();
      state.send('startRun');
      state.send('worldReady');
      scene.setMenuMode(false);
      hud.setVisible(true);
      runClock.startedAt = performance.now();
      audio.ambience.setDistrict(scene.currentDistrictId, 1.2);
    });
  });

  bus.on('ui:requestQuit', () => {
    void ui.transitions.wrap(() => {
      save.flush();
      // The menu sits in orbit, so the world's ambience has no business
      // playing over it.
      audio.ambience.silence();
      scene.setMenuMode(true);
      hud.setVisible(false);
      showMainMenu(bus, ui, settings, save, () => scene.resetRun());
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
  try {
    // Ren is a real 3D rig, procedurally assembled from the concept sheet's
    // specification. A billboard was never right for a game whose camera orbits
    // a sphere — the character has to have a back, cast a shadow, and turn —
    // and a procedural rig also gives locomotion that actually cycles, which no
    // amount of sprite work could have done with one drawing per action.
    const { RenAnimator } = await import('@game/entities/RenAnimator');
    scene.setCharacter(new RenAnimator());
  } catch (error) {
    console.warn('[Character] falling back to the placeholder rig', error);
  }
}

function wirePauseFlow(
  bus: EventBus,
  ui: UIManager,
  settings: SettingsManager,
  scene: PlanetScene,
  state: GameStateManager,
  audio: AudioManager,
  runClock: { startedAt: number },
): void {
  const pauseScreen = new PauseScreen(bus, settings, () => ({
    elapsedSeconds: (performance.now() - runClock.startedAt) / 1000,
    contractsComplete: 0,
    shards: 0,
  }));

  const pause = () => {
    if (scene.isMenuMode) return;
    if (!state.send('pause')) return;
    scene.setPaused(true);
    ui.setHudVisible(false);
    ui.push(pauseScreen);
    audio.duck(0.25);
  };

  const resume = () => {
    if (!state.send('resume')) return;
    ui.popAll();
    ui.setHudVisible(true);
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
function wireGameplay(
  bus: EventBus,
  ui: UIManager,
  scene: PlanetScene,
  save: SaveManager,
  hud: Hud,
): void {
  bus.on('ui:requestDialogueAdvance', () => scene.dialogue.advance());

  bus.on('district:lit', ({ district, litCount }) => {
    // Districts are identified by id on the bus; the player sees the name.
    const name = DISTRICTS.find((d) => d.id === district)?.displayName ?? district;
    ui.showToast(t('toast.districtLit', { name, count: litCount, total: DISTRICTS.length }));
  });

  bus.on('shard:collected', ({ total, of }) => {
    ui.showToast(t('toast.shard', { count: total, total: of }));
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

  bus.on('district:lit', ({ district }) => {
    save.update((draft) => {
      if (!draft.progress.litDistricts.includes(district)) {
        draft.progress.litDistricts.push(district);
      }
    });
  });

  bus.on('run:completed', ({ seconds, ratings, districtsLit }) => {
    const best = save.get().stats.bestRunSeconds;
    save.update((draft) => {
      draft.stats.runsCompleted++;
      if (best === null || seconds < best) draft.stats.bestRunSeconds = seconds;
    });

    hud.setVisible(false);
    ui.push(
      new RouteReportScreen(bus, {
        seconds,
        ratings,
        shards: scene.shards.collected,
        shardTotal: scene.shards.total,
        districtsLit,
        bestSeconds: best,
      }),
    );
  });

  // "Keep exploring" from the report simply closes it — the lit planet is
  // still there, and the shards are still worth hunting.
  bus.on('ui:requestResume', () => hud.setVisible(true));
}
