const heading = ({ name, song = false }) => `${song ? 'Lied' : 'Neue Liedermappe'}: ${name}`;

export function shareText({ name, link, password = null, song = false }) {
  return [heading({ name, song }), link, ...(password ? [`Passwort: ${password}`] : [])].join('\n');
}

export async function shareBinder({ name, link, password, song = false, file = null }, { share = globalThis.navigator?.share?.bind(globalThis.navigator), canShare = globalThis.navigator?.canShare?.bind(globalThis.navigator), copy = text => globalThis.navigator.clipboard.writeText(text) } = {}) {
  const text = shareText({ name, link, password, song });
  if (share) {
    const plain = { title: heading({ name, song }), text };
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
