/**
 * Director Desk — Auto-initialize a DirectorProject from panel metadata.
 *
 * Pure server-safe module: no React, no three, no I/O.
 * Runs when a panel has no saved directorLayout yet, so we can bootstrap a
 * plausible 3D layout from shotType / characters / props / location /
 * photographyRules the storyboard planner already produced.
 */

import {
  createDefaultDirectorProject,
  DEFAULT_CHARACTER_COLORS,
  type DirectorObject,
  type DirectorProject,
  type PosePresetId,
} from './schema';

// ---------- Types ----------

export interface InitInputCharacter {
  name: string;
  appearance?: string;
  slot?: string;
  imageUrl?: string | null;
  imageMediaId?: string | null;
}

export interface InitInputProp {
  name: string;
  imageUrl?: string | null;
  imageMediaId?: string | null;
}

export interface InitInputLocation {
  name: string;
  imageUrl?: string | null;
  imageMediaId?: string | null;
  availableSlots?: string[];
}

export interface InitInput {
  panel: {
    shotType: string | null;
    description: string | null;
    characters: InitInputCharacter[];
    props: InitInputProp[];
    location: null | InitInputLocation;
    photographyRules: unknown | null;
  };
  project: { videoRatio: string };
}

// ---------- Helpers ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ---------- Camera inference ----------

export function inferCamera(shotType: string | null): {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
} {
  const s = shotType ?? '';
  // First match wins: close-up first, then wide, then tilt variants.
  if (s.includes('特写') || s.includes('近景')) {
    return { fov: 35, position: [0, 1.6, 2.0], target: [0, 1.6, 0] };
  }
  if (s.includes('全景') || s.includes('远景')) {
    return { fov: 60, position: [0, 3, 10], target: [0, 1.2, 0] };
  }
  if (s.includes('仰拍')) {
    return { fov: 50, position: [0, 0.8, 5.4], target: [0, 1.6, 0] };
  }
  if (s.includes('俯拍')) {
    return { fov: 50, position: [0, 3.5, 4.0], target: [0, 0.5, 0] };
  }
  // Default = 中景.
  return { fov: 50, position: [0, 1.55, 5.4], target: [0, 1.05, 0] };
}

// ---------- Facing prose → radians ----------

/** Keyword table exported for consistency with the prose mapper elsewhere. */
export const FACING_TEXT_TO_RAD: ReadonlyArray<{
  keywords: readonly string[];
  rad: number;
}> = [
  // Order matters: check specific/longer phrases before shorter ones.
  { keywords: ['面向画面左', '看向画面左', '面向左侧', '面向左', '面朝左', '向左'], rad: Math.PI / 2 },
  { keywords: ['面向画面右', '看向画面右', '面向右侧', '面向右', '面朝右', '向右'], rad: -Math.PI / 2 },
  { keywords: ['背对镜头', '背对', '背面'], rad: Math.PI },
  { keywords: ['面向镜头', '面向观众', '正对', '正面'], rad: 0 },
];

export function parseFacingText(text: string | undefined): number {
  if (!text) return 0;
  for (const rule of FACING_TEXT_TO_RAD) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) return rule.rad;
    }
  }
  return 0;
}

// ---------- Screen position prose → x/z ----------

const X_RULES: ReadonlyArray<[RegExp, number]> = [
  [/左方|左前方|画面左/, -2],
  [/左中|左侧偏中/, -1.5],
  [/正中|中央|中间/, 0],
  [/右中|右侧偏中/, 1.5],
  [/右方|右前方|画面右/, 2],
];

const Z_RULES: ReadonlyArray<[RegExp, number]> = [
  [/前景|近景/, 2],
  [/后景|远景|背景/, -2],
];

export function parseScreenPosition(text: string | undefined): {
  x: number | null;
  z: number | null;
} {
  if (!text) return { x: null, z: null };
  let x: number | null = null;
  let z: number | null = null;
  // Iterate in listed order; last match wins.
  for (const [re, val] of X_RULES) {
    if (re.test(text)) x = val;
  }
  for (const [re, val] of Z_RULES) {
    if (re.test(text)) z = val;
  }
  return { x, z };
}

// ---------- Main ----------

export function initDirectorProjectFromPanel(
  input: InitInput,
): DirectorProject {
  const { panel } = input;
  const base = createDefaultDirectorProject();

  // 1. Backdrop from location image.
  if (panel.location?.imageMediaId) {
    base.scene.backdropAssetId = panel.location.imageMediaId;
    base.scene.backdropImageUrl = panel.location.imageUrl ?? null;
  }

  // 2. Camera inference from shotType. Replace the default primary camera.
  const camInfer = inferCamera(panel.shotType);
  base.cameras[0] = {
    id: 'cam-1',
    name: '主机位',
    fov: camInfer.fov,
    position: camInfer.position,
    target: camInfer.target,
    visible: true,
  };

  // 3. Parse photographyRules defensively.
  const rules = isRecord(panel.photographyRules) ? panel.photographyRules : null;
  const rawRuleChars =
    rules && Array.isArray(rules.characters) ? rules.characters : [];
  const ruleChars = rawRuleChars.filter(isRecord);

  const objects: DirectorObject[] = [];

  // Pre-scan character x/z so we can decide even-spread fallback and camera nudge.
  const n = panel.characters.length;
  const inferredXs: Array<number | null> = [];
  const inferredZs: Array<number | null> = [];
  for (const char of panel.characters) {
    const rule =
      ruleChars.find(
        (r) => typeof r.name === 'string' && r.name === char.name,
      ) ?? null;
    const screenPos =
      rule && typeof rule.screen_position === 'string'
        ? rule.screen_position
        : undefined;
    const pos = parseScreenPosition(screenPos);
    inferredXs.push(pos.x);
    inferredZs.push(pos.z);
  }
  const anyXFound = inferredXs.some((v) => v !== null);

  // 4. Characters.
  for (let i = 0; i < panel.characters.length; i++) {
    const char = panel.characters[i];
    const rule =
      ruleChars.find(
        (r) => typeof r.name === 'string' && r.name === char.name,
      ) ?? null;
    const posture =
      rule && typeof rule.posture === 'string' ? rule.posture : '';
    const facingText =
      rule && typeof rule.facing === 'string' ? rule.facing : undefined;

    let posePresetId: PosePresetId = 'stand';
    if (posture.includes('坐')) posePresetId = 'sit';
    else if (posture.includes('蹲')) posePresetId = 'crouch';
    else if (posture.includes('跪')) posePresetId = 'kneel-one';

    const facing = parseFacingText(facingText);
    const x = anyXFound ? inferredXs[i] ?? 0 : (i - (n - 1) / 2) * 1.5;
    const z = inferredZs[i] ?? 0;
    const color =
      DEFAULT_CHARACTER_COLORS[i % DEFAULT_CHARACTER_COLORS.length];
    const refId = char.imageMediaId ?? null;

    objects.push({
      id: `char-${uid()}`,
      kind: 'character',
      name: char.name,
      refId,
      visible: true,
      locked: false,
      color,
      mode: 'billboard',
      transform: {
        position: [x, 0, z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      imageUrl: char.imageUrl ?? null,
      bodyType: 'mannequin',
      posePresetId,
      facing,
    });
  }

  // 5. Props (skip those without a media id since we can't render them).
  const usableProps = panel.props.filter((p) => Boolean(p.imageMediaId));
  const np = usableProps.length;
  for (let i = 0; i < usableProps.length; i++) {
    const prop = usableProps[i];
    const px = (i - (np - 1) / 2) * 0.8;
    const refId = prop.imageMediaId ?? null;
    objects.push({
      id: `prop-${uid()}`,
      kind: 'prop',
      name: prop.name,
      refId,
      visible: true,
      locked: false,
      color: '#888',
      mode: 'billboard',
      transform: {
        position: [px, 0, -1.5],
        rotation: [0, 0, 0],
        scale: [0.6, 0.6, 0.6],
      },
      imageUrl: prop.imageUrl ?? null,
    });
  }

  // 6. Nudge camera target when characters (with inferred x) are one-sided.
  const validInferred = inferredXs.filter((v): v is number => v !== null);
  if (validInferred.length > 0) {
    const total = validInferred.length;
    const leftCount = validInferred.filter((x) => x < -0.5).length;
    const rightCount = validInferred.filter((x) => x > 0.5).length;
    const [tx, ty, tz] = base.cameras[0].target;
    if (leftCount / total >= 0.6) {
      base.cameras[0].target = [tx + 0.5, ty, tz];
    } else if (rightCount / total >= 0.6) {
      base.cameras[0].target = [tx - 0.5, ty, tz];
    }
  }

  return { ...base, objects };
}
