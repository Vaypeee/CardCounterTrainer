/* Discreet "share" links (results, last duel): the system share sheet where there is one (phones),
   otherwise copy the text + link to the clipboard. The link points to the trainer's home page. */
export const siteLink = () => `${location.origin}/`;

export async function share(text, btn) {
  const url = siteLink(), label = btn.textContent;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    btn.textContent = 'copied';
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // share sheet closed
    btn.textContent = 'copy failed';
  }
  setTimeout(() => { btn.textContent = label; }, 1800);
}
