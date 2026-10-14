// Saving a file from the phone: the share sheet where it exists (iPhone, Android), else a download.

export async function saveFile(name: string, text: string, type = 'application/json'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  if (mobile && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // fall through to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export function pickFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? await f.text() : null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 16).replace(/[:T]/g, '-');
}
