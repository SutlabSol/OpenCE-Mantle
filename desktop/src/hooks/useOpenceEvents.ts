import { useEffect, useState } from 'react';

export function useOpenceEvents() {
  const [logs, setLogs] = useState<{ level: string; message: string; timestamp: number }[]>([]);
  const [progress, setProgress] = useState<{ taskId: string; stage: string; percent: number } | null>(null);

  useEffect(() => {
    const offLog = window.opence.onLog((e) => setLogs((prev) => [...prev.slice(-199), e]));
    const offProgress = window.opence.onProgress((e) => {
      setProgress(e);
      if (e.percent >= 100) {
        setTimeout(() => setProgress((cur) => (cur?.taskId === e.taskId ? null : cur)), 600);
      }
    });
    return () => {
      offLog();
      offProgress();
    };
  }, []);

  const log = (level: 'info' | 'warn' | 'error', message: string) =>
    setLogs((prev) => [...prev.slice(-199), { level, message, timestamp: Date.now() }]);

  return { logs, progress, log };
}
