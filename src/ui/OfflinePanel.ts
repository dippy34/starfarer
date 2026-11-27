import { downloadOfflineCopy, offlineErrorWords, offlineSnapshot, partialOfflineCopy, pruneOfflineCopies, removeOfflineCopy, type OfflineProgress, type OfflineSnapshot } from '../platform/offline';
import './offline.css';

const megabytes = (bytes: number): string => Math.max(1, Math.ceil(bytes / 1e6)).toLocaleString('en-US');

/** The small Use offline part of More. Browser storage and worker APIs stay in platform/offline.ts. */
export class OfflinePanel {
  private readonly el: HTMLElement;
  private snapshot: OfflineSnapshot | null = null;
  private busy = false;
  private loaded = false;

  constructor(list: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'offline-panel';
    this.el.setAttribute('aria-label', 'Use offline');
    this.el.innerHTML = `
      <h3>Use offline</h3>
      <p class="offline-status" data-offline-status role="status" aria-live="polite">Check the offline copy when you open More.</p>
      <button class="btn primary offline-download" type="button" data-offline-download disabled>Checking the download size…</button>
      <progress data-offline-progress max="1" value="0" aria-label="Offline download progress" hidden></progress>
      <p class="offline-progress-words" data-offline-progress-words hidden></p>
      <p class="offline-note" data-offline-wifi>Use Wi-Fi: this is a large download.</p>
      <p class="offline-note" data-offline-storage>Checking the space on this device…</p>
      <p class="offline-note" data-offline-persistence hidden></p>
      <button class="btn offline-remove" type="button" data-offline-remove hidden>Remove the offline copy</button>`;
    const save = list.querySelector('[data-act="save"]');
    list.insertBefore(this.el, save?.previousElementSibling ?? save);
    this.$('[data-offline-download]').addEventListener('click', () => void this.download());
    this.$('[data-offline-remove]').addEventListener('click', () => void this.remove());
    // A page that loads clears what an update left behind, once no tab uses it. It never starts a worker.
    void pruneOfflineCopies();
    const hud = list.closest('#hud');
    if (hud) {
      new MutationObserver(() => {
        if (!this.loaded && !this.busy && hud.getAttribute('data-sheet') === 'more') void this.prepare();
      }).observe(hud, { attributes: true, attributeFilter: ['data-sheet'] });
    }
  }

  private $(selector: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(selector)!;
  }

  private text(selector: string, text: string): void {
    if (this.$(selector).textContent !== text) this.$(selector).textContent = text;
  }

  private async prepare(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.text('[data-offline-status]', 'Checking this device…');
    try {
      this.snapshot = await offlineSnapshot();
      this.loaded = true;
      this.busy = false;
      this.render();
    } catch (error) {
      this.text('[data-offline-status]', 'The offline copy is not available yet.');
      this.text('[data-offline-storage]', 'Connect to the internet, then open More to try again.');
      this.$('[data-offline-download]').setAttribute('disabled', '');
    } finally {
      this.busy = false;
    }
  }

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const size = megabytes(snapshot.totalBytes);
    const partial = snapshot.partial;
    const ready = snapshot.ready;
    this.text('[data-offline-status]', partial ? `A download stopped at ${megabytes(partial.bytes)} MB of ${megabytes(partial.totalBytes)} MB. Download carries on from there.` : ready ? 'Starfarer works offline' : snapshot.activeVersion ? 'An offline copy is on this device. Update it for this version of Starfarer.' : 'Keep Starfarer and all its data on this device.');
    const download = this.$('[data-offline-download]') as HTMLButtonElement;
    download.disabled = this.busy || ready;
    download.hidden = ready;
    this.text('[data-offline-download]', partial ? `Download again to carry on (about ${megabytes(Math.max(0, partial.totalBytes - partial.bytes))} MB left)` : snapshot.activeVersion ? `Update the offline copy (about ${size} MB)` : `Download everything for offline use (about ${size} MB)`);
    this.$('[data-offline-wifi]').toggleAttribute('hidden', ready);
    const remove = this.$('[data-offline-remove]') as HTMLButtonElement;
    remove.hidden = !ready && !partial;
    // (Remove takes everything away: with an older copy still kept beside a stopped update, that is the offline copy)
    this.text('[data-offline-remove]', partial && !snapshot.activeVersion ? 'Remove the partial download' : 'Remove the offline copy');
    remove.disabled = this.busy;
    const available = snapshot.estimate.available;
    const need = partial ? Math.max(0, partial.totalBytes - partial.bytes) : snapshot.totalBytes;
    this.text('[data-offline-storage]', available === undefined
      ? `The copy takes about ${size} MB. This browser could not estimate the free space.`
      : `The copy takes about ${size} MB. ${megabytes(available)} MB free on this device.${available < need ? ' That may not be enough room.' : ''}`);
    if (snapshot.persistent !== null && ready) this.persistence(snapshot.persistent);
  }

  private persistence(granted: boolean | null): void {
    const line = this.$('[data-offline-persistence]');
    line.hidden = granted === null;
    this.text('[data-offline-persistence]', granted
      ? 'This phone will keep the offline copy when space gets low.'
      : 'This phone would not promise persistent storage. It may remove the offline copy when space is low.');
  }

  private progress(progress: OfflineProgress): void {
    const bar = this.$('[data-offline-progress]') as HTMLProgressElement;
    bar.hidden = false;
    bar.max = Math.max(1, progress.totalBytes);
    bar.value = progress.completedBytes;
    const words = this.$('[data-offline-progress-words]');
    words.hidden = false;
    const reused = progress.networkTotalBytes < progress.totalBytes;
    this.text('[data-offline-progress-words]', `${megabytes(progress.completedBytes)} of ${megabytes(progress.totalBytes)} MB · ${progress.completedFiles.toLocaleString('en-US')} of ${progress.totalFiles.toLocaleString('en-US')} files${reused ? ` · ${megabytes(progress.networkBytes)} of ${megabytes(progress.networkTotalBytes)} MB downloaded; the rest is already on this device` : ''}`);
  }

  private async download(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const button = this.$('[data-offline-download]') as HTMLButtonElement;
    button.disabled = true;
    this.text('[data-offline-status]', 'Downloading the offline copy. Keep Starfarer open.');
    try {
      const done = await downloadOfflineCopy((progress) => this.progress(progress));
      if (this.snapshot) this.snapshot = { ...this.snapshot, ready: true, partial: null, activeVersion: done.version, persistent: done.persistent };
      this.render();
      this.persistence(done.persistent);
    } catch (error) {
      // A stopped download keeps what it fetched: say how far it got, and Download carries on.
      if (this.snapshot) this.snapshot = { ...this.snapshot, partial: await partialOfflineCopy(this.snapshot.version).catch(() => null) };
      this.render();
      this.text('[data-offline-status]', offlineErrorWords(error));
      button.disabled = false;
    } finally {
      this.busy = false;
      const remove = this.$('[data-offline-remove]') as HTMLButtonElement;
      remove.disabled = false;
    }
  }

  private async remove(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const button = this.$('[data-offline-remove]') as HTMLButtonElement;
    button.disabled = true;
    this.text('[data-offline-status]', 'Removing the offline copy…');
    try {
      await removeOfflineCopy();
      if (this.snapshot) this.snapshot = { ...this.snapshot, ready: false, activeVersion: null, partial: null };
      const bar = this.$('[data-offline-progress]');
      bar.hidden = true;
      this.$('[data-offline-progress-words]').hidden = true;
      this.$('[data-offline-persistence]').hidden = true;
      this.render();
      this.text('[data-offline-status]', 'Offline copy removed. Starfarer uses the internet again.');
    } catch (error) {
      this.text('[data-offline-status]', 'The offline copy could not be removed. Try again.');
      button.disabled = false;
    } finally {
      this.busy = false;
      if (this.snapshot && !this.snapshot.ready) (this.$('[data-offline-download]') as HTMLButtonElement).disabled = false;
    }
  }
}

