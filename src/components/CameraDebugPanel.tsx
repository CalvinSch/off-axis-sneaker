import React, { useState, useEffect } from 'react';
import { Video } from 'lucide-react';
import type { CameraDebugOffsets } from '../utils/offAxisCamera';

interface CameraDebugPanelProps {
  onOffsetsChange: (offsets: CameraDebugOffsets) => void;
  initialOffsets: CameraDebugOffsets;
}

const CameraDebugPanel: React.FC<CameraDebugPanelProps> = ({
  onOffsetsChange,
  initialOffsets,
}) => {
  const [position, setPosition] = useState(initialOffsets.position);
  const [lookAt, setLookAt] = useState(initialOffsets.lookAt);
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    setPosition(initialOffsets.position);
    setLookAt(initialOffsets.lookAt);
  }, [initialOffsets]);

  const pushOffsets = (nextPos: typeof position, nextLook: typeof lookAt) => {
    onOffsetsChange({ position: nextPos, lookAt: nextLook });
  };

  const handlePositionChange = (axis: 'x' | 'y' | 'z', value: number) => {
    const next = { ...position, [axis]: value };
    setPosition(next);
    pushOffsets(next, lookAt);
  };

  const handleLookAtChange = (axis: 'x' | 'y' | 'z', value: number) => {
    const next = { ...lookAt, [axis]: value };
    setLookAt(next);
    pushOffsets(position, next);
  };

  return (
    <div className="absolute top-4 right-24 z-20">
      {isCollapsed ? (
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-1.5 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded transition-colors backdrop-blur-sm"
          aria-label="Open camera debug controls"
          title="Camera debug"
        >
          <Video size={14} />
        </button>
      ) : (
        <div className="bg-black bg-opacity-70 backdrop-blur-sm text-white rounded-lg shadow-lg max-w-xs">
          <div className="flex items-center justify-between p-4 pb-2">
            <span className="text-xs text-gray-300 pr-2">Camera offset</span>
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1.5 hover:bg-white hover:bg-opacity-10 rounded transition-colors"
              aria-label="Close camera debug controls"
            >
              <Video size={14} />
            </button>
          </div>

          <div className="space-y-3 px-4 pb-4">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Eye position +</p>
            <div>
              <label className="text-xs block mb-1">Pos X: {position.x.toFixed(3)}</label>
              <input
                type="range"
                min="-0.35"
                max="0.35"
                step="0.005"
                value={position.x}
                onChange={(e) => handlePositionChange('x', parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>
            <div>
              <label className="text-xs block mb-1">Pos Y: {position.y.toFixed(3)}</label>
              <input
                type="range"
                min="-0.35"
                max="0.35"
                step="0.005"
                value={position.y}
                onChange={(e) => handlePositionChange('y', parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>
            <div>
              <label className="text-xs block mb-1">Pos Z: {position.z.toFixed(3)}</label>
              <input
                type="range"
                min="-0.35"
                max="0.35"
                step="0.005"
                value={position.z}
                onChange={(e) => handlePositionChange('z', parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            <div className="pt-2 border-t border-gray-600">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">Look-at +</p>
              <div>
                <label className="text-xs block mb-1">Target X: {lookAt.x.toFixed(3)}</label>
                <input
                  type="range"
                  min="-0.25"
                  max="0.25"
                  step="0.005"
                  value={lookAt.x}
                  onChange={(e) => handleLookAtChange('x', parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>
              <div className="mt-2">
                <label className="text-xs block mb-1">Target Y: {lookAt.y.toFixed(3)}</label>
                <input
                  type="range"
                  min="-0.25"
                  max="0.25"
                  step="0.005"
                  value={lookAt.y}
                  onChange={(e) => handleLookAtChange('y', parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>
              <div className="mt-2">
                <label className="text-xs block mb-1">Target Z: {lookAt.z.toFixed(3)}</label>
                <input
                  type="range"
                  min="-0.5"
                  max="0.5"
                  step="0.005"
                  value={lookAt.z}
                  onChange={(e) => handleLookAtChange('z', parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraDebugPanel;
