import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ThreeSceneManager } from '../utils/threeScene';
import { HeadPose } from '../utils/headPose';
import { CalibrationData } from '../utils/calibration';
import type { CameraDebugOffsets } from '../utils/offAxisCamera';

interface ThreeViewProps {
  headPose: HeadPose | null;
  environmentPlyUrl?: string | null;
}

export interface ThreeViewHandle {
  updateCalibration: (calibration: CalibrationData) => void;
  setDebugMode: (enabled: boolean) => void;
  updateModelPosition: (x: number, y: number, z: number) => void;
  updateModelScale: (scale: number) => void;
  updateModelRotation: (x: number, y: number, z: number) => void;
  getModelPosition: () => { x: number; y: number; z: number };
  getModelScale: () => number;
  getModelRotation: () => { x: number; y: number; z: number };
  setCameraDebugOffsets: (offsets: CameraDebugOffsets) => void;
  getCameraDebugOffsets: () => CameraDebugOffsets;
}

const ThreeView = forwardRef<ThreeViewHandle, ThreeViewProps>(({ headPose, environmentPlyUrl }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<ThreeSceneManager | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const MIN = 2;

    const tryCreate = () => {
      if (sceneManagerRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < MIN || h < MIN) return;

      const manager = new ThreeSceneManager({
        container,
        width: w,
        height: h,
        environmentPlyUrl,
      });
      sceneManagerRef.current = manager;
      manager.start();
    };

    tryCreate();

    const resizeObserver = new ResizeObserver(() => {
      tryCreate();
      if (container.clientWidth >= MIN && container.clientHeight >= MIN && sceneManagerRef.current) {
        sceneManagerRef.current.resize(container.clientWidth, container.clientHeight);
      }
    });
    resizeObserver.observe(container);

    const handleWindowResize = () => {
      if (container.clientWidth >= MIN && container.clientHeight >= MIN && sceneManagerRef.current) {
        sceneManagerRef.current.resize(container.clientWidth, container.clientHeight);
      }
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      resizeObserver.disconnect();
      if (sceneManagerRef.current) {
        sceneManagerRef.current.dispose();
        sceneManagerRef.current = null;
      }
    };
  }, [environmentPlyUrl]);

  useEffect(() => {
    if (headPose && sceneManagerRef.current) {
      sceneManagerRef.current.updateHeadPose(headPose);
    }
  }, [headPose]);

  useImperativeHandle(ref, () => ({
    updateCalibration: (calibration: CalibrationData) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateCalibration(calibration);
      }
    },
    setDebugMode: (enabled: boolean) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.setDebugMode(enabled);
      }
    },
    updateModelPosition: (x: number, y: number, z: number) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateModelPosition(x, y, z);
      }
    },
    updateModelScale: (scale: number) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateModelScale(scale);
      }
    },
    getModelPosition: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getModelPosition();
      }
      return { x: 0, y: -0.09, z: -0.03 };
    },
    getModelScale: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getModelScale();
      }
      return 0.071;
    },
    updateModelRotation: (x: number, y: number, z: number) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateModelRotation(x, y, z);
      }
    },
    getModelRotation: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getModelRotation();
      }
      return { x: 0, y: -0.628, z: 0 };
    },
    setCameraDebugOffsets: (offsets: CameraDebugOffsets) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.setCameraDebugOffsets(offsets);
      }
    },
    getCameraDebugOffsets: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getCameraDebugOffsets();
      }
      return {
        position: { x: 0, y: 0, z: 0 },
        lookAt: { x: 0, y: 0, z: 0 },
      };
    },
  }));

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-black pointer-events-none"
      style={{ touchAction: 'none' }}
    />
  );
});

ThreeView.displayName = 'ThreeView';

export default ThreeView;
