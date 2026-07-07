/**
 * Director Desk — 摄影规则反向推导
 *
 * 服务端可用（不依赖 React / three）。根据 DirectorProject 中的相机与角色 transform，
 * 推导出中文的 photographyRules.characters[] 描述，用于保存时反向同步。
 */

import type { DirectorProject } from './schema';
import { POSE_ZH } from './schema';

// ---------- 类型 ----------

export interface ProjectedCharacter {
  nx: number;
  ny: number;
  depthDelta: number;
  facingLabel: string;
  postureLabel: string;
  screenPositionLabel: string;
  name: string;
}

type Vec3 = readonly [number, number, number];

// ---------- 向量数学 ----------

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): [number, number, number] {
  const l = length(v);
  if (l < 1e-9) return [0, 0, 0];
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------- 投影 ----------

/**
 * 将世界空间的角色位置投影到相机 NDC。
 * - nx, ny 位于 [-1, 1]（超出即在画面外）
 * - depth 为角色沿相机 forward 方向的距离（米），正值 = 相机前方
 */
export function projectCharacterToScreen(params: {
  charPos: Vec3;
  camFov: number;
  camPos: Vec3;
  camTarget: Vec3;
  aspect: number;
}): { nx: number; ny: number; depth: number } {
  const { charPos, camFov, camPos, camTarget, aspect } = params;

  const forward = normalize(sub(camTarget, camPos));
  const worldUp: Vec3 = [0, 1, 0];
  let right = normalize(cross(forward, worldUp));
  // 相机看向正上方 / 正下方时的退化处理
  if (length(right) < 1e-6) {
    right = [1, 0, 0];
  }
  const up = cross(right, forward);

  const rel = sub(charPos, camPos);
  const xcam = dot(rel, right);
  const ycam = dot(rel, up);
  // forward 指向被摄物；depth 为正值代表在相机前方
  let zcam = dot(rel, forward);
  if (zcam < 0.1) zcam = 0.1;

  const fovRad = (camFov * Math.PI) / 180;
  const focalLength = 1 / Math.tan(fovRad / 2);
  const nx = (focalLength / aspect) * (xcam / zcam);
  const ny = focalLength * (ycam / zcam);
  return { nx, ny, depth: zcam };
}

// ---------- 中文标签 ----------

export function toScreenPositionLabel(nx: number, ny: number): string {
  const col = nx < -0.33 ? '左侧' : nx > 0.33 ? '右侧' : '正中';
  const row = ny > 0.33 ? '上方' : ny < -0.33 ? '下方' : '中部';
  if (col === '正中') return '画面正中';
  return `画面${col}${row}`;
}

// 姿势中文映射：优先使用本模块自定义，其次回落到 schema 中的 POSE_ZH
const POSTURE_ZH_OVERRIDE: Record<string, string> = {
  stand: '站立',
  sit: '坐着',
  crouch: '蹲伏',
};

export function toPostureLabel(posePresetId: string | undefined | null): string {
  if (!posePresetId) return '站立';
  if (posePresetId in POSTURE_ZH_OVERRIDE) {
    return POSTURE_ZH_OVERRIDE[posePresetId];
  }
  const zh = (POSE_ZH as Record<string, string>)[posePresetId];
  return zh ?? '站立';
}

/**
 * 朝向标签：
 * - facing=0 → 面向镜头
 * - facing=π → 背对镜头
 * - facing=π/2 → 面向画面左侧
 * - facing=-π/2 → 面向画面右侧
 *
 * 坐标约定：Y 向上，相机默认位于 +Z 看向 -Z。角色 facing=0 时正面朝向 +Z（迎向相机）。
 * 绕 Y 轴旋转 facing 后，角色朝向在 XZ 平面为 (-sin(facing), cos(facing))：
 * - facing=π/2 → (-1, 0)（-X = 画面左侧）
 * - facing=-π/2 → (1, 0)（+X = 画面右侧）
 */
export function toFacingLabel(
  facingRad: number,
  camPos: Vec3,
  charPos: Vec3,
): string {
  // 角色 → 相机（XZ 平面），归一化
  const dx = camPos[0] - charPos[0];
  const dz = camPos[2] - charPos[2];
  const dLen = Math.hypot(dx, dz);
  if (dLen < 1e-6) return '面向镜头';
  const camDirX = dx / dLen;
  const camDirZ = dz / dLen;

  // 角色朝向（XZ 平面）
  const charForwardX = -Math.sin(facingRad);
  const charForwardZ = Math.cos(facingRad);

  // 从 camDir 到 charForward 的有符号夹角
  const dotVal = camDirX * charForwardX + camDirZ * charForwardZ;
  const crossVal = camDirX * charForwardZ - camDirZ * charForwardX;
  const angle = Math.atan2(crossVal, dotVal);

  const EIGHTH = Math.PI / 8;
  if (Math.abs(angle) < EIGHTH) return '面向镜头';
  if (Math.abs(Math.abs(angle) - Math.PI) < EIGHTH) return '背对镜头';
  return angle > 0 ? '面向画面左侧' : '面向画面右侧';
}

// ---------- 汇总 ----------

/** 从项目中挑选活跃相机；找不到则回落到第一台 */
function pickActiveCamera(project: DirectorProject) {
  return (
    project.cameras.find((c) => c.id === project.activeCameraId) ??
    project.cameras[0] ??
    null
  );
}

export interface PhotographyRulesPatch {
  characters: Array<{
    name: string;
    screen_position: string;
    posture: string;
    facing: string;
  }>;
}

export function computePhotographyRulesPatch(params: {
  project: DirectorProject;
}): PhotographyRulesPatch {
  const { project } = params;
  const cam = pickActiveCamera(project);
  if (!cam) return { characters: [] };

  const visibleChars = project.objects.filter(
    (o) => o.kind === 'character' && o.visible !== false,
  );
  if (visibleChars.length === 0) return { characters: [] };

  const aspect = 9 / 16;

  // 先计算每个角色的深度（供前后景相对判定）
  const projected = visibleChars.map((obj) => {
    const proj = projectCharacterToScreen({
      charPos: obj.transform.position,
      camFov: cam.fov,
      camPos: cam.position,
      camTarget: cam.target,
      aspect,
    });
    return { obj, proj };
  });

  const avgDepth =
    projected.reduce((s, p) => s + p.proj.depth, 0) / projected.length;

  const characters = projected.map(({ obj, proj }) => {
    let screenPosition = toScreenPositionLabel(proj.nx, proj.ny);
    if (projected.length > 1) {
      if (proj.depth < avgDepth * 0.8) screenPosition += '前景';
      else if (proj.depth > avgDepth * 1.2) screenPosition += '后景';
    }
    // 角色朝向优先使用 obj.facing；回落到 transform.rotation.y
    const facingRad = obj.facing ?? obj.transform.rotation[1] ?? 0;
    return {
      name: obj.name,
      screen_position: screenPosition,
      posture: toPostureLabel(obj.posePresetId),
      facing: toFacingLabel(facingRad, cam.position, obj.transform.position),
    };
  });

  return { characters };
}
