import type { PosePresetId } from '@/lib/director-desk/schema'

/**
 * Pose presets for the 20 PosePresetIds — each is a map of joint control keys
 * consumed by ProceduralMannequin: `<part>.pitch|yaw|roll` (in degrees) and
 * `<limb>.bend` for elbow/knee.
 *
 * The stand preset is empty (zeros). Others adjust joint angles to approximate
 * the pose. Values are hand-tuned — good enough for storyboard blocking.
 */
export const POSE_PRESETS: Record<PosePresetId, Record<string, number>> = {
  stand: {},
  't-pose': {
    'leftShoulder.pitch': 0,
    'leftShoulder.spread': -85,
    'rightShoulder.pitch': 0,
    'rightShoulder.spread': 85,
  },
  walk: {
    'leftShoulder.pitch': -25,
    'rightShoulder.pitch': 25,
    'leftHip.pitch': 22,
    'rightHip.pitch': -22,
    'leftKnee.bend': 18,
    'rightKnee.bend': 10,
  },
  run: {
    'body.pitch': 10,
    'leftShoulder.pitch': -55,
    'leftElbow.bend': 78,
    'rightShoulder.pitch': 55,
    'rightElbow.bend': 78,
    'leftHip.pitch': 40,
    'leftKnee.bend': 55,
    'rightHip.pitch': -32,
    'rightKnee.bend': 20,
  },
  sit: {
    'leftHip.pitch': 88,
    'rightHip.pitch': 88,
    'leftKnee.bend': 88,
    'rightKnee.bend': 88,
  },
  crouch: {
    'body.pitch': 22,
    'leftHip.pitch': 88,
    'rightHip.pitch': 88,
    'leftKnee.bend': 88,
    'rightKnee.bend': 88,
    'leftShoulder.pitch': 22,
    'rightShoulder.pitch': 22,
  },
  'kneel-one': {
    'leftHip.pitch': 88,
    'leftKnee.bend': 88,
    'rightHip.pitch': 0,
    'rightKnee.bend': 88,
  },
  'kneel-two': {
    'leftHip.pitch': 25,
    'rightHip.pitch': 25,
    'leftKnee.bend': 88,
    'rightKnee.bend': 88,
  },
  'hands-on-hips': {
    'leftShoulder.pitch': 22,
    'leftShoulder.spread': -40,
    'leftElbow.bend': 88,
    'rightShoulder.pitch': 22,
    'rightShoulder.spread': 40,
    'rightElbow.bend': 88,
  },
  lean: {
    'body.roll': 18,
    'body.pitch': 6,
    'leftHip.pitch': -8,
    'rightHip.pitch': -4,
  },
  bow: {
    'body.pitch': 55,
    'leftShoulder.pitch': 20,
    'rightShoulder.pitch': 20,
  },
  think: {
    'rightShoulder.pitch': -20,
    'rightShoulder.spread': 55,
    'rightElbow.bend': 88,
    'head.pitch': 10,
    'head.yaw': -12,
  },
  fight: {
    'body.yaw': 22,
    'leftShoulder.pitch': -20,
    'leftShoulder.spread': -30,
    'leftElbow.bend': 88,
    'rightShoulder.pitch': -15,
    'rightShoulder.spread': 30,
    'rightElbow.bend': 55,
    'leftHip.pitch': 12,
    'leftKnee.bend': 25,
    'rightHip.pitch': -6,
    'rightKnee.bend': 15,
  },
  kick: {
    'body.pitch': -12,
    'rightHip.pitch': 78,
    'rightKnee.bend': 15,
    'leftHip.pitch': -10,
    'leftKnee.bend': 8,
    'leftShoulder.spread': -30,
    'rightShoulder.spread': 25,
  },
  throw: {
    'body.yaw': -18,
    'rightShoulder.pitch': -80,
    'rightShoulder.spread': 40,
    'rightElbow.bend': 55,
    'leftShoulder.pitch': -25,
    'leftShoulder.spread': -30,
  },
  push: {
    'leftShoulder.pitch': -70,
    'leftElbow.bend': 22,
    'rightShoulder.pitch': -70,
    'rightElbow.bend': 22,
    'body.pitch': 18,
  },
  wave: {
    'rightShoulder.pitch': -70,
    'rightShoulder.spread': 65,
    'rightElbow.bend': 55,
    'head.yaw': 8,
  },
  reach: {
    'rightShoulder.pitch': -85,
    'rightShoulder.spread': 20,
    'rightElbow.bend': 8,
    'body.pitch': 6,
  },
  'cross-arms': {
    'leftShoulder.pitch': 15,
    'leftShoulder.spread': -25,
    'leftElbow.bend': 88,
    'rightShoulder.pitch': 15,
    'rightShoulder.spread': 25,
    'rightElbow.bend': 88,
  },
  phone: {
    'rightShoulder.pitch': -30,
    'rightShoulder.spread': 40,
    'rightElbow.bend': 88,
    'head.pitch': 22,
    'head.yaw': 8,
  },
}

export function getPosePreset(id?: string | null): Record<string, number> {
  if (!id) return {}
  return POSE_PRESETS[id as PosePresetId] ?? {}
}
