/**
 * Director Desk — 3D 分镜编辑器数据模型
 *
 * 该文件是 server-safe 的（不导入 React 或 three），
 * 供 Prisma / API / worker / 前端 store 共用。
 */

// ---------- Constants ----------

export const DIRECTOR_PROJECT_VERSION = 1;

/** 角色颜色调色板（7 色） */
export const DEFAULT_CHARACTER_COLORS = [
  '#E56C5B',
  '#7AA7FF',
  '#6CDB7A',
  '#F5C151',
  '#B67DDE',
  '#4CC3D9',
  '#FF8FA3',
] as const;

/** 20 个姿势预设 id */
export const POSE_PRESET_IDS = [
  'stand',
  't-pose',
  'walk',
  'run',
  'sit',
  'crouch',
  'kneel-one',
  'kneel-two',
  'hands-on-hips',
  'lean',
  'bow',
  'think',
  'fight',
  'kick',
  'throw',
  'push',
  'wave',
  'reach',
  'cross-arms',
  'phone',
] as const;

export type PosePresetId = (typeof POSE_PRESET_IDS)[number];

/** 姿势中文映射 */
export const POSE_ZH: Record<string, string> = {
  'stand': '站立',
  't-pose': 'T-姿势',
  'walk': '行走',
  'run': '奔跑',
  'sit': '坐着',
  'crouch': '蹲伏',
  'kneel-one': '单膝跪',
  'kneel-two': '双膝跪',
  'hands-on-hips': '叉腰',
  'lean': '倚靠',
  'bow': '鞠躬',
  'think': '沉思',
  'fight': '打斗',
  'kick': '踢',
  'throw': '投掷',
  'push': '推搡',
  'wave': '挥手',
  'reach': '伸手',
  'cross-arms': '抱臂',
  'phone': '看手机',
};

/** 8 种体型 id */
export const BODY_TYPE_IDS = [
  'mannequin',
  'female',
  'broad',
  'muscular',
  'slim',
  'teen',
  'child',
  'chibi',
] as const;

export type BodyTypeId = (typeof BODY_TYPE_IDS)[number];

// ---------- Types ----------

export type DirectorRenderMode = 'billboard' | 'mannequin';

export type DirectorObjectKind = 'character' | 'prop' | 'crowd';

export interface DirectorTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface DirectorObject {
  id: string;
  kind: DirectorObjectKind;
  name: string;
  /** character: CharacterAppearance.imageMediaId; prop: LocationImage.imageMediaId; crowd: null */
  refId: string | null;
  visible: boolean;
  locked: boolean;
  color: string;
  mode: DirectorRenderMode;
  transform: DirectorTransform;
  /** not persisted; resolved at load time */
  imageUrl?: string | null;
  // character-specific
  bodyType?: BodyTypeId;
  posePresetId?: PosePresetId;
  poseControls?: Record<string, number>;
  /** radians around Y; undefined = billboard always faces camera */
  facing?: number;
  // crowd-specific
  crowdCount?: [number, number];
  crowdSpacing?: [number, number];
}

export interface DirectorCamera {
  id: string;
  name: string;
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
  visible?: boolean;
}

export interface DirectorSceneSettings {
  backgroundColor: string;
  showGround: boolean;
  groundOpacity: number;
  showLabels: boolean;
  showGrid: boolean;
  /** 背景图 MediaObject.id */
  backdropAssetId: string | null;
  backdropOpacity: number;
  backdropYaw: number;
  /** not persisted; resolved at load time */
  backdropImageUrl?: string | null;
}

export interface DirectorProject {
  version: 1;
  scene: DirectorSceneSettings;
  objects: DirectorObject[];
  cameras: DirectorCamera[];
  activeCameraId: string;
}

const MAX_PROJECT_JSON_BYTES = 1024 * 1024;

// ---------- Type guards ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isNumTriplet(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

function isTransform(v: unknown): v is DirectorTransform {
  if (!isRecord(v)) return false;
  return (
    isNumTriplet(v.position) && isNumTriplet(v.rotation) && isNumTriplet(v.scale)
  );
}

function isRenderMode(v: unknown): v is DirectorRenderMode {
  return v === 'billboard' || v === 'mannequin';
}

function isObjectKind(v: unknown): v is DirectorObjectKind {
  return v === 'character' || v === 'prop' || v === 'crowd';
}

function isBodyTypeId(v: unknown): v is BodyTypeId {
  return typeof v === 'string' && (BODY_TYPE_IDS as readonly string[]).includes(v);
}

function isPosePresetId(v: unknown): v is PosePresetId {
  return typeof v === 'string' && (POSE_PRESET_IDS as readonly string[]).includes(v);
}

// ---------- Helpers ----------

export function validateDirectorProjectSize(json: string): boolean {
  return json.length <= MAX_PROJECT_JSON_BYTES;
}

export function createDefaultDirectorProject(): DirectorProject {
  return {
    version: DIRECTOR_PROJECT_VERSION,
    scene: {
      backgroundColor: '#1a1d23',
      showGround: true,
      groundOpacity: 0.8,
      showLabels: true,
      showGrid: true,
      backdropAssetId: null,
      backdropOpacity: 0.6,
      backdropYaw: 0,
      backdropImageUrl: null,
    },
    objects: [],
    cameras: [
      {
        id: 'cam-1',
        name: '主机位',
        fov: 50,
        position: [0, 1.55, 5.4],
        target: [0, 1.05, 0],
        visible: true,
      },
    ],
    activeCameraId: 'cam-1',
  };
}

function parseScene(input: unknown): DirectorSceneSettings | null {
  if (!isRecord(input)) return null;
  const def = createDefaultDirectorProject().scene;
  const backgroundColor =
    typeof input.backgroundColor === 'string'
      ? input.backgroundColor
      : def.backgroundColor;
  const showGround =
    typeof input.showGround === 'boolean' ? input.showGround : def.showGround;
  const groundOpacity =
    typeof input.groundOpacity === 'number' && Number.isFinite(input.groundOpacity)
      ? input.groundOpacity
      : def.groundOpacity;
  const showLabels =
    typeof input.showLabels === 'boolean' ? input.showLabels : def.showLabels;
  const showGrid =
    typeof input.showGrid === 'boolean' ? input.showGrid : def.showGrid;
  const backdropAssetId =
    typeof input.backdropAssetId === 'string' ? input.backdropAssetId : null;
  const backdropOpacity =
    typeof input.backdropOpacity === 'number' &&
    Number.isFinite(input.backdropOpacity)
      ? input.backdropOpacity
      : def.backdropOpacity;
  const backdropYaw =
    typeof input.backdropYaw === 'number' && Number.isFinite(input.backdropYaw)
      ? input.backdropYaw
      : def.backdropYaw;
  return {
    backgroundColor,
    showGround,
    groundOpacity,
    showLabels,
    showGrid,
    backdropAssetId,
    backdropOpacity,
    backdropYaw,
    backdropImageUrl: null,
  };
}

function parseObject(input: unknown): DirectorObject | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== 'string' || !input.id) return null;
  if (!isObjectKind(input.kind)) return null;
  if (typeof input.name !== 'string') return null;
  if (!isTransform(input.transform)) return null;
  const refId =
    typeof input.refId === 'string'
      ? input.refId
      : input.refId === null
      ? null
      : undefined;
  if (refId === undefined) return null;
  if (typeof input.visible !== 'boolean') return null;
  if (typeof input.locked !== 'boolean') return null;
  if (typeof input.color !== 'string') return null;
  if (!isRenderMode(input.mode)) return null;

  const obj: DirectorObject = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    refId,
    visible: input.visible,
    locked: input.locked,
    color: input.color,
    mode: input.mode,
    transform: input.transform,
  };

  if (isBodyTypeId(input.bodyType)) obj.bodyType = input.bodyType;
  if (isPosePresetId(input.posePresetId)) obj.posePresetId = input.posePresetId;
  if (isRecord(input.poseControls)) {
    const controls: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.poseControls)) {
      if (typeof v === 'number' && Number.isFinite(v)) controls[k] = v;
    }
    obj.poseControls = controls;
  }
  if (typeof input.facing === 'number' && Number.isFinite(input.facing)) {
    obj.facing = input.facing;
  }
  if (
    Array.isArray(input.crowdCount) &&
    input.crowdCount.length === 2 &&
    typeof input.crowdCount[0] === 'number' &&
    typeof input.crowdCount[1] === 'number'
  ) {
    obj.crowdCount = [input.crowdCount[0], input.crowdCount[1]];
  }
  if (
    Array.isArray(input.crowdSpacing) &&
    input.crowdSpacing.length === 2 &&
    typeof input.crowdSpacing[0] === 'number' &&
    typeof input.crowdSpacing[1] === 'number'
  ) {
    obj.crowdSpacing = [input.crowdSpacing[0], input.crowdSpacing[1]];
  }
  // imageUrl is transient — never accepted from parse input
  return obj;
}

function parseCamera(input: unknown): DirectorCamera | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== 'string' || !input.id) return null;
  if (typeof input.name !== 'string') return null;
  if (typeof input.fov !== 'number' || !Number.isFinite(input.fov)) return null;
  if (!isNumTriplet(input.position)) return null;
  if (!isNumTriplet(input.target)) return null;
  const cam: DirectorCamera = {
    id: input.id,
    name: input.name,
    fov: input.fov,
    position: input.position,
    target: input.target,
    visible: typeof input.visible === 'boolean' ? input.visible : true,
  };
  return cam;
}

export function parseDirectorProject(json: unknown): DirectorProject | null {
  if (!isRecord(json)) return null;
  if (json.version !== DIRECTOR_PROJECT_VERSION) return null;
  const scene = parseScene(json.scene);
  if (!scene) return null;
  if (!Array.isArray(json.objects)) return null;
  if (!Array.isArray(json.cameras)) return null;
  if (typeof json.activeCameraId !== 'string' || !json.activeCameraId) return null;

  const objects: DirectorObject[] = [];
  for (const raw of json.objects) {
    const parsed = parseObject(raw);
    if (!parsed) return null;
    // strip transient field
    delete parsed.imageUrl;
    objects.push(parsed);
  }

  const cameras: DirectorCamera[] = [];
  for (const raw of json.cameras) {
    const parsed = parseCamera(raw);
    if (!parsed) return null;
    cameras.push(parsed);
  }

  // strip transient scene field
  scene.backdropImageUrl = null;

  return {
    version: DIRECTOR_PROJECT_VERSION,
    scene,
    objects,
    cameras,
    activeCameraId: json.activeCameraId,
  };
}

export function serializeDirectorProject(p: DirectorProject): string {
  const stripped: DirectorProject = {
    ...p,
    scene: { ...p.scene },
    objects: p.objects.map((o) => ({ ...o })),
    cameras: p.cameras.map((c) => ({ ...c })),
  };
  delete stripped.scene.backdropImageUrl;
  for (const o of stripped.objects) {
    delete o.imageUrl;
  }
  return JSON.stringify(stripped);
}
