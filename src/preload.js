const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id) => ipcRenderer.invoke('meetings:get', id),
  createMeeting: () => ipcRenderer.invoke('meetings:create'),
  saveMeeting: (m) => ipcRenderer.invoke('meetings:save', m),
  deleteMeeting: (id) => ipcRenderer.invoke('meetings:delete', id),

  getEngines: () => ipcRenderer.invoke('transcription:engines'),
  listOutputs: () => ipcRenderer.invoke('devices:outputs'),

  startRecording: (opts) => ipcRenderer.invoke('recording:start', opts),
  setOutput: (outputId) => ipcRenderer.invoke('recording:set-output', outputId),
  pauseRecording: () => ipcRenderer.invoke('recording:pause'),
  resumeRecording: () => ipcRenderer.invoke('recording:resume'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  sendMicAudio: (pcm) => ipcRenderer.send('recording:mic-audio', pcm),

  onSegment: (cb) => subscribe('transcription:segment', cb),
  onStatus: (cb) => subscribe('transcription:status', cb),
  onLevel: (cb) => subscribe('audio:level', cb),
  onSystemDevice: (cb) => subscribe('audio:system-device', cb),

  enhanceNotes: (meetingId) => ipcRenderer.invoke('notes:enhance', { meetingId }),
  onNotesDelta: (cb) => subscribe('notes:delta', cb),
});
