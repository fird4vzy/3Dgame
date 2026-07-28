# 11 — Class Diagram

**Deliverable 10 of 12.** Split into four views to stay readable.

## 11.1 Core & engine services

```mermaid
classDiagram
    class Game {
        -container: ServiceContainer
        -loop: GameLoop
        +bootstrap() Promise~void~
        +start() void
        +dispose() void
    }

    class GameLoop {
        -accumulator: number
        -fixedDt: number
        +start() void
        +stop() void
        -frame(now) void
    }

    class EventBus~TMap~ {
        +on(event, handler) Unsubscribe
        +once(event, handler) Unsubscribe
        +emit(event, payload) void
        +off(event, handler) void
    }

    class Store~T~ {
        -state: T
        +get() Readonly~T~
        +set(patch) void
        +subscribe(selector, cb) Unsubscribe
    }

    class StateMachine~S,E,C~ {
        +current: S
        +send(event) boolean
        +can(event) boolean
        +onTransition(cb) Unsubscribe
    }

    class ObjectPool~T~ {
        -free: T[]
        -active: Set~T~
        +acquire() T
        +release(item) void
        +prewarm(n) void
    }

    class ServiceContainer {
        +register(token, factory) void
        +resolve(token) T
    }

    Game --> ServiceContainer
    Game --> GameLoop
    Game --> EventBus
    GameLoop --> World
```

```mermaid
classDiagram
    class ISceneManager {
        <<interface>>
        +push(scene, params) Promise~void~
        +pop() Promise~void~
        +replace(scene, params) Promise~void~
        +current() IScene
    }
    class IAssetManager {
        <<interface>>
        +acquire(bundle) Promise~void~
        +release(bundle) void
        +get(id) T
        +progress() number
    }
    class IAudioManager {
        <<interface>>
        +playSfx(id, opts) VoiceHandle
        +playAt(id, position) VoiceHandle
        +setBusVolume(bus, v) void
        +music() MusicDirector
    }
    class IInputManager {
        <<interface>>
        +getAxis2D(action) Vec2
        +isDown(action) boolean
        +wasPressed(action) boolean
        +setActionMap(id) void
        +activeDevice() DeviceKind
    }
    class ICollisionSystem {
        <<interface>>
        +buildWorld(meshes) void
        +moveCapsule(capsule, delta) MoveResult
        +raycast(origin, dir, maxDist) HitResult
        +queryNear(pos, radius) Interactable[]
    }
    class ISaveManager {
        <<interface>>
        +load() SaveData
        +save(data) void
        +autosave() void
        +reset() void
    }
    class IAnimationManager {
        <<interface>>
        +createController(entity, manifest) AnimationController
        +update(dt) void
    }

    class SceneManager
    class AssetManager
    class AudioManager
    class InputManager
    class BvhCollisionSystem
    class SaveManager
    class AnimationManager

    ISceneManager <|.. SceneManager
    IAssetManager <|.. AssetManager
    IAudioManager <|.. AudioManager
    IInputManager <|.. InputManager
    ICollisionSystem <|.. BvhCollisionSystem
    ISaveManager <|.. SaveManager
    IAnimationManager <|.. AnimationManager
```

Every subsystem is consumed through its interface and resolved from the
container. That is what lets `QuestSystem` be unit-tested with a fake
`IAudioManager` and no GPU — the practical payoff of the D in SOLID.

## 11.2 Entity & component model

```mermaid
classDiagram
    class Entity {
        +id: string
        +object3D: Object3D
        +tags: Set~string~
        +addComponent(c) T
        +getComponent(type) T
        +removeComponent(type) void
        +destroy() void
    }

    class Component {
        <<abstract>>
        #entity: Entity
        +onAttach() void
        +fixedUpdate(dt) void
        +update(dt) void
        +lateUpdate(dt) void
        +onDetach() void
    }

    class World {
        -entities: Map
        +spawn(prefab, transform) Entity
        +despawn(entity) void
        +query(tag) Entity[]
        +fixedUpdate(dt) void
        +update(dt) void
    }

    class SphericalCharacterController {
        -velocity: Vector3
        -grounded: boolean
        -up: Vector3
        +move(input, dt) void
        -resolveCollision() void
        -snapToGround() void
        -orientToSurface(dt) void
    }

    class CarryComponent {
        -parcel: ParcelEntity
        +attach(parcel) void
        +detach() ParcelEntity
        +isCarrying: boolean
    }

    class GlideComponent {
        +deploy() void
        +stow() void
        -applyThermals(dt) void
    }

    class InteractableComponent {
        +radius: number
        +promptKey: string
        +canInteract(actor) boolean
        +interact(actor) void
    }

    class AnimationController {
        -mixer: AnimationMixer
        -fsm: StateMachine
        +play(state, fade) void
        +setSpeed(v) void
        +setLayerWeight(layer, w) void
    }

    class NpcBrain {
        -schedule: ScheduleEntry[]
        +update(dt) void
    }

    Component <|-- SphericalCharacterController
    Component <|-- CarryComponent
    Component <|-- GlideComponent
    Component <|-- InteractableComponent
    Component <|-- AnimationController
    Component <|-- NpcBrain
    Entity "1" o-- "*" Component
    World "1" o-- "*" Entity
    SphericalCharacterController ..> ICollisionSystem
    AnimationController ..> IAnimationManager
```

## 11.3 Gameplay systems

```mermaid
classDiagram
    class QuestSystem {
        -contracts: Map~string, ContractState~
        +load(defs) void
        +available() Contract[]
        +accept(id) void
        +complete(id, warmth) void
        -reevaluate() void
    }

    class DeliverySystem {
        +offerFrom(npc) void
        +tryDeliver(npc) boolean
        -runHandoff() Promise~void~
    }

    class WarmthSystem {
        -active: Map~ParcelId, number~
        +tick(dt) void
        +ratingFor(id) Rating
    }

    class IlluminationSystem {
        -districts: Map~DistrictId, LightState~
        +ignite(district) Promise~void~
        +restore(saved) void
        -animateLamps(d, t) void
    }

    class DialogueSystem {
        -graph: DialogueNode[]
        +start(id) Promise~void~
        +advance() void
        +choose(index) void
    }

    class InteractionSystem {
        -hash: SpatialHash
        +register(i) void
        +focused() Interactable
        +update(dt) void
    }

    class CameraDirector {
        -stack: CameraBehaviour[]
        +push(behaviour) void
        +pop() void
        +lateUpdate(dt) void
    }

    class ScoreSystem {
        +recordDelivery(rating, t) void
        +buildReport() RouteReport
    }

    class MusicDirector {
        -stems: Map~string, GainNode~
        +startAll() void
        +enableStem(id, fadeMs) void
    }

    QuestSystem --> DeliverySystem
    DeliverySystem --> WarmthSystem
    DeliverySystem --> DialogueSystem
    QuestSystem --> IlluminationSystem
    IlluminationSystem --> MusicDirector
    QuestSystem --> ScoreSystem
    DeliverySystem --> InteractionSystem
    DeliverySystem --> CameraDirector
    QuestSystem ..> ISaveManager
```

Systems talk to each other through the `EventBus` wherever the arrow would
otherwise create a cycle. The arrows above are *direct* calls only, and the
graph is acyclic by construction — a rule worth enforcing in review.

## 11.4 UI layer

```mermaid
classDiagram
    class UIManager {
        -stack: UIScreen[]
        +push(screen, params) void
        +pop() void
        +showToast(msg) void
        +setHudVisible(v) void
    }
    class UIScreen {
        <<abstract>>
        +id: string
        +onEnter(params) void
        +onExit() void
        +trapFocus() void
    }
    class HudLayer {
        +compass: CompassRibbon
        +contract: ContractCard
        +prompt: PromptChip
        +update(state) void
    }
    class WorldAnchor {
        +worldPos: Vector3
        +project(camera) void
    }

    UIScreen <|-- LoadingScreen
    UIScreen <|-- MainMenuScreen
    UIScreen <|-- PauseScreen
    UIScreen <|-- SettingsScreen
    UIScreen <|-- WardrobeScreen
    UIScreen <|-- RouteReportScreen
    UIManager "1" o-- "*" UIScreen
    UIManager --> HudLayer
    HudLayer "1" o-- "*" WorldAnchor
    UIManager ..> EventBus : emits intents
    UIManager ..> Store : reads projection
```
