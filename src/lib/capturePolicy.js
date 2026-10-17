export function captureWorkPolicy({pendingTasks=0,deviceMemory}={}) {
  const underPressure=pendingTasks>=8 || (Number(deviceMemory)>0 && Number(deviceMemory)<=2);
  return {burstFrames:underPressure?2:3,useNativeStill:!underPressure};
}
