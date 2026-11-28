export function shareText({ name, link, password = null }) {
  return [`Neue Liedermappe: ${name}`, link, ...(password ? [`Passwort: ${password}`] : [])].join('\n');
}

export async function shareBinder({ name, link, password, file = null }, { share = globalThis.navigator?.share?.bind(globalThis.navigator), canShare = globalThis.navigator?.canShare?.bind(globalThis.navigator), copy = text => globalThis.navigator.clipboard.writeText(text) } = {}) {
  const text = shareText({ name, link, password });
  if (share) {
    const plain = { title: `Neue Liedermappe: ${name}`, text };
    const withFile = file && canShare?.({ files: [file] }) ? { files: [file], text } : null;
    try {
      await share(withFile ?? plain);
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  await copy(text);
  return 'copied';
}
