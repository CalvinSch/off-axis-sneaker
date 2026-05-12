import * as THREE from 'three';
import { HeadPose } from './headPose';
import { CalibrationData } from './calibration';

export interface HeadPositionWorld {
  x: number;
  y: number;
  z: number;
}

/** Added on top of head-derived pose; look-at offsets apply to the default target (eye.x, eye.y, 0). */
export interface CameraDebugOffsets {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

export class OffAxisCamera {
  private camera: THREE.PerspectiveCamera;
  private calibration: CalibrationData;
  private screenWidthWorld: number;
  private screenHeightWorld: number;
  private nearPlane: number = 0.05;
  private farPlane: number = 1000;
  private cameraDebugOffsets: CameraDebugOffsets = {
    position: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 0, z: 0 },
  };

  constructor(camera: THREE.PerspectiveCamera, calibration: CalibrationData) {
    this.camera = camera;
    this.calibration = calibration;

    const worldScale = 0.01;
    this.screenWidthWorld = calibration.screenWidthCm * worldScale;
    this.screenHeightWorld = calibration.screenHeightCm * worldScale;
  }

  updateCalibration(calibration: CalibrationData): void {
    this.calibration = calibration;
    const worldScale = 0.01;
    this.screenWidthWorld = calibration.screenWidthCm * worldScale;
    this.screenHeightWorld = calibration.screenHeightCm * worldScale;
  }

  headPoseToWorldPosition(headPose: HeadPose): HeadPositionWorld {
    const worldScale = 0.01;
    const movementScale = 1.5;

    const normalizedX = headPose.x;
    const normalizedY = headPose.y;

    const headXWorld = -(normalizedX - 0.5) * this.screenWidthWorld * movementScale;
    const headYWorld = -(normalizedY - 0.5) * this.screenHeightWorld * movementScale;

    const baseDistance = this.calibration.viewingDistanceCm * worldScale;
    const depthScale = 1.0 / headPose.z;
    const headZWorld = baseDistance * depthScale;

    return {
      x: headXWorld,
      y: headYWorld,
      z: headZWorld,
    };
  }

  updateProjectionMatrix(headPosition: HeadPositionWorld): void {
    const near = this.nearPlane;
    const far = this.farPlane;

    const screenLeft = -this.screenWidthWorld / 2;
    const screenRight = this.screenWidthWorld / 2;
    const screenBottom = -this.screenHeightWorld / 2;
    const screenTop = this.screenHeightWorld / 2;

    const eyeX = headPosition.x;
    const eyeY = headPosition.y;
    const eyeZ = headPosition.z;

    const screenZ = 0;

    const viewerToScreenDistance = eyeZ - screenZ;

    if (viewerToScreenDistance <= 0) {
      return;
    }

    const n_over_d = near / viewerToScreenDistance;

    const left = (screenLeft - eyeX) * n_over_d;
    const right = (screenRight - eyeX) * n_over_d;
    const bottom = (screenBottom - eyeY) * n_over_d;
    const top = (screenTop - eyeY) * n_over_d;

    this.camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  setCameraDebugOffsets(offsets: CameraDebugOffsets): void {
    this.cameraDebugOffsets = {
      position: { ...offsets.position },
      lookAt: { ...offsets.lookAt },
    };
  }

  getCameraDebugOffsets(): CameraDebugOffsets {
    return {
      position: { ...this.cameraDebugOffsets.position },
      lookAt: { ...this.cameraDebugOffsets.lookAt },
    };
  }

  private effectiveEye(worldPos: HeadPositionWorld): HeadPositionWorld {
    const p = this.cameraDebugOffsets.position;
    return {
      x: worldPos.x + p.x,
      y: worldPos.y + p.y,
      z: worldPos.z + p.z,
    };
  }

  setCameraPosition(headPosition: HeadPositionWorld): void {
    const l = this.cameraDebugOffsets.lookAt;
    this.camera.position.set(headPosition.x, headPosition.y, headPosition.z);
    this.camera.lookAt(headPosition.x + l.x, headPosition.y + l.y, l.z);
  }

  updateFromHeadPose(headPose: HeadPose): void {
    const worldPos = this.headPoseToWorldPosition(headPose);
    const eye = this.effectiveEye(worldPos);
    this.setCameraPosition(eye);
    this.updateProjectionMatrix(eye);
  }

  getScreenDimensions(): { width: number; height: number } {
    return {
      width: this.screenWidthWorld,
      height: this.screenHeightWorld,
    };
  }
}
