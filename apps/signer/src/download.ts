export function requestDownload(filename: string, bytes: Uint8Array, mediaType: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Some browsers resolve download navigation after the current task. Keep the
  // small local Blob alive long enough for that navigation, then release it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
