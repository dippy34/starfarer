"""The trailer's score: an original ambient piece, synthesised here with numpy (a placeholder the
owner can replace). Stereo, 48 kHz, as long as the cut, on its grid (timeline.py).

    python3 trailer/score.py out.wav

A warm pad that changes chord every two bars, a deep bass note under it, a sparse bell motif with
a long tail, a soft arpeggio that builds from the middle, a rise into the title and one low hit on
it. Everything goes through one reverb (convolution with decaying noise). Phone speakers play
nothing below about 150 Hz, so every low sound also has overtones that carry it up there.
"""
import sys
import wave

import numpy as np

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from timeline import BAR, BEAT, FADE_OUT, LENGTH, TITLE_AT  # noqa: E402

SR = 48000
N = int(round(LENGTH * SR))
rng = np.random.default_rng(20261121)  # the piece is the same every time


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def t_axis(n):
    return np.arange(n) / SR


def place(bus, start, sig, pan=0.0):
    """add a mono signal to a stereo bus at `start` seconds, panned (-1 left .. 1 right, equal power)"""
    i = int(round(start * SR))
    if i >= N:
        return
    sig = sig[:N - i]
    a = (pan + 1) * np.pi / 4
    bus[0, i:i + len(sig)] += sig * np.cos(a)
    bus[1, i:i + len(sig)] += sig * np.sin(a)


def smooth_env(n, attack, release):
    """rise over `attack` s, hold, fall over `release` s (raised-cosine edges)"""
    e = np.ones(n)
    a, r = min(int(attack * SR), n // 2), min(int(release * SR), n // 2)
    if a:
        e[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if r:
        e[-r:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, r))
    return e


# ---------------------------------------------------------------------------- the harmony
# (start bar, bass note, pad voicing) in MIDI notes. D major with a lydian colour on the IV.
CHORDS = [
    (0, 38, [50, 57, 64, 66, 69]),        # Dmaj9
    (2, 35, [47, 54, 62, 64, 69]),        # Bm11
    (4, 31, [43, 50, 59, 66, 73]),        # Gmaj7#11
    (6, 40, [52, 59, 62, 66, 67]),        # Em9
    (7.5, 38, [50, 57, 64, 66, 69]),      # Dmaj9 (tap anything)
    (9, 35, [47, 54, 62, 64, 69]),        # Bm11 (gravity let loose)
    (10, 31, [43, 50, 59, 66, 73]),       # Gmaj7#11
    (11.5, 35, [47, 54, 62, 66, 69]),     # Bm7 (the pull-out)
    (12.5, 33, [45, 52, 59, 64, 69]),     # Asus2 (the rise)
    (TITLE_AT / BAR, 26, [50, 57, 62, 64, 66, 69, 73]),  # Dmaj9, wide (the title)
]


def pad_note(f, n, bright, seed):
    """a warm, slowly moving note: three detuned voices of decaying harmonics; `bright` per sample"""
    r = np.random.default_rng(seed)
    t = t_axis(n)
    left, right = np.zeros(n), np.zeros(n)
    for v, cents in enumerate((-7, 0, 7)):
        fv = f * 2 ** (cents / 1200)
        drift = 1 + 0.0015 * np.sin(2 * np.pi * r.uniform(0.05, 0.12) * t + r.uniform(0, 6.3))
        phase = 2 * np.pi * fv * np.cumsum(drift) / SR
        voice = np.zeros(n)
        for k in range(1, 11):
            if fv * k > 9000:
                break
            amp = np.exp(-(k - 1) / bright) / k ** 1.1
            voice += amp * np.sin(k * phase + r.uniform(0, 6.3))
        swell = 0.75 + 0.25 * np.sin(2 * np.pi * r.uniform(0.07, 0.15) * t + r.uniform(0, 6.3))
        voice *= swell
        pan = (v - 1) * 0.7
        left += voice * np.cos((pan + 1) * np.pi / 4)
        right += voice * np.sin((pan + 1) * np.pi / 4)
    return np.stack([left, right])


def bass_note(f, n):
    """a deep sine with a little 2nd-4th harmonic (what a phone speaker can play of it)"""
    t = t_axis(n)
    ph = 2 * np.pi * f * t
    return np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.18 * np.sin(3 * ph + 0.5) + 0.1 * np.sin(4 * ph + 1.0)


def bell(f, length=6.0):
    """FM bell: an inharmonic modulator whose depth dies away faster than the tone"""
    n = int(length * SR)
    t = t_axis(n)
    index = 2.2 * np.exp(-t / 0.5)
    tone = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * 3.5 * t))
    tone += 0.25 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.8)
    env = np.exp(-t / 1.9) * np.minimum(1, t / 0.004)
    return tone * env


def pluck(f, length=1.6):
    n = int(length * SR)
    t = t_axis(n)
    ph = 2 * np.pi * f * t
    return (np.sin(ph) + 0.3 * np.sin(2 * ph) * np.exp(-t / 0.15)) * np.exp(-t / 0.32) * np.minimum(1, t / 0.006)


def noise_band(n, lo, hi):
    """white noise kept between `lo` and `hi` Hz (arrays per sample: a time-varying band, by STFT)"""
    hop, win = 1024, 4096
    w = np.hanning(win)
    out = np.zeros(n + win)
    freqs = np.fft.rfftfreq(win, 1 / SR)
    for s in range(0, n, hop):
        c = min(s + win // 2, n - 1)
        spec = np.fft.rfft(rng.standard_normal(win) * w)
        l, h = lo[c], hi[c]
        mask = np.clip((freqs - l) / (0.3 * l), 0, 1) * np.clip((h - freqs) / (0.3 * h), 0, 1)
        out[s:s + win] += np.fft.irfft(spec * mask) * w
    return out[:n] / 1.5


def reverb_ir(seconds, rt60, seed):
    """a stereo impulse response: decaying noise, the highs dying faster than the lows"""
    n = int(seconds * SR)
    t = t_axis(n)
    r = np.random.default_rng(seed)
    out = []
    for _ in range(2):
        x = r.standard_normal(n)
        spec = np.fft.rfft(x)
        f = np.fft.rfftfreq(n, 1 / SR)
        low = np.fft.irfft(spec * (f < 2500), n)
        high = np.fft.irfft(spec * (f >= 2500), n)
        tau = rt60 / 6.91
        ir = low * np.exp(-t / tau) + high * np.exp(-t / (tau * 0.45))
        ir *= np.minimum(1, t / 0.03)  # (no early slap)
        pre = int(0.025 * SR)
        out.append(np.concatenate([np.zeros(pre), ir])[:n])
    out = np.array(out)
    return out / np.sqrt((out ** 2).sum(axis=1, keepdims=True))


def convolve(x, ir):
    m = x.shape[1] + ir.shape[1]
    size = 1 << (m - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)
    return y[:, :x.shape[1]]


def high_pass(x, fc):
    """gentle high-pass by FFT (second-order-like slope); removes rumble no speaker can play"""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    g = (f / fc) ** 2 / np.sqrt(1 + (f / fc) ** 4)
    return np.fft.irfft(spec * g, x.shape[-1])


def low_shelf_cut(x, fc, gain_db):
    """turn down everything above `fc` by `gain_db` (smoothly): no hiss or edge on a phone speaker"""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    g = 10 ** (gain_db / 20)
    w = 1 / (1 + (fc / np.maximum(f, 1)) ** 2)
    return np.fft.irfft(spec * (1 + (g - 1) * w), x.shape[-1])


def main(out):
    dry = np.zeros((2, N))
    send = np.zeros((2, N))  # what goes to the reverb

    # pad and bass: each chord from its bar to the next, overlapping a beat for a soft change
    for i, (b, root, voicing) in enumerate(CHORDS):
        start = b * BAR - (0.0 if i == 0 else BEAT)
        end = CHORDS[i + 1][0] * BAR + BEAT if i + 1 < len(CHORDS) else LENGTH
        n = int((end - start) * SR)
        t = t_axis(n)
        # brighter as the piece builds; the title chord opens up
        title = i == len(CHORDS) - 1
        build = min(1, b * BAR / TITLE_AT)
        bright = 1.6 + 2.2 * build + 0.8 * np.sin(2 * np.pi * 0.09 * t) ** 2
        if title:
            bright = 3.5 + 1.5 * np.exp(-t / 2)
        attack = 2.0 if i == 0 else BEAT
        env = smooth_env(n, attack, BEAT * 1.2)
        level = 0.13 if title else 0.11
        for j, m in enumerate(voicing):
            note = pad_note(hz(m), n, bright, seed=100 * i + j) * env * level / np.sqrt(len(voicing))
            place(dry, start, note[0] * 0.6, -1)
            place(dry, start, note[1] * 0.6, 1)
            place(send, start, note[0] * 0.8, -1)
            place(send, start, note[1] * 0.8, 1)
        if not title:
            bass = bass_note(hz(root), n) * smooth_env(n, 1.5 if i == 0 else BEAT * 1.5, BEAT * 1.5) * 0.16
            place(dry, start, bass, 0)
            place(send, start, bass * 0.15, 0)

    # the bell motif: sparse, in the upper register, answered across the stereo field
    motif = [  # (bar, beat, MIDI note, level)
        (0, 2, 81, 0.9), (1, 0, 78, 0.7), (1, 2.5, 76, 0.6),
        (2, 2, 78, 0.8), (3, 0, 74, 0.6), (3, 1.5, 76, 0.5),
        (4, 0, 83, 0.8), (4, 2, 78, 0.6), (5, 1, 85, 0.6),
        (6, 0, 79, 0.7), (6, 2.5, 78, 0.6), (7, 2, 74, 0.6),
        (8, 0, 81, 0.8), (8, 3, 76, 0.5),
        (9, 0, 83, 0.7), (9, 2.5, 78, 0.6), (10, 1, 85, 0.6), (10, 3, 79, 0.5),
        (11, 2, 81, 0.7),
    ]
    # after the title, counted from it
    t_bar = TITLE_AT / BAR
    motif += [(t_bar, 1, 81, 0.9), (t_bar, 3, 78, 0.7), (t_bar + 1, 2, 76, 0.8), (t_bar + 2, 0, 74, 0.5)]
    for k, (b, beat, m, lv) in enumerate(motif):
        s = bell(hz(m)) * 0.085 * lv
        pan = (-0.45, 0.45)[k % 2]
        place(dry, b * BAR + beat * BEAT, s, pan)
        place(send, b * BAR + beat * BEAT, s * 1.6, pan)

    # the arpeggio: eighth notes from bar 4, growing, through the chords' upper notes; it stops
    # half a bar before the title so the hit lands in a breath of space
    arp_end = TITLE_AT - BAR / 2
    step = BEAT / 2
    t0 = 4 * BAR
    k = 0
    while t0 + k * step < arp_end:
        t = t0 + k * step
        chord = [c for c in CHORDS if c[0] * BAR <= t + 1e-6][-1][2]
        upper = sorted({(m - 60) % 12 + 72 for m in chord})
        m = upper[(k * 3) % len(upper)] + (12 if k % 8 == 7 else 0)
        lv = 0.25 + 0.75 * (t - t0) / (arp_end - t0)
        s = pluck(hz(m)) * 0.05 * lv
        pan = np.sin(k * 0.9) * 0.6
        place(dry, t, s, pan)
        place(send, t, s * 1.2, pan)
        k += 1

    # the rise: two bars of noise whose band climbs, and swells, into the hit
    rs, re = TITLE_AT - 2 * BAR, TITLE_AT
    n = int((re - rs) * SR)
    x = np.linspace(0, 1, n)
    lo = 200 * 2 ** (4.5 * x)
    hi = 1200 * 2 ** (3.0 * x)
    swell = x ** 2.2 * smooth_env(n, 0.5, 0.02)
    for ch, pan in ((0, -0.8), (1, 0.8)):
        rise = noise_band(n, lo, hi) * swell * 0.11
        place(dry, rs, rise, pan)
        place(send, rs, rise * 0.7, pan)

    # the hit: a falling sub, a body a phone can play, a puff of noise; all into a long tail
    n = int(4.0 * SR)
    t = t_axis(n)
    f = 38 + 60 * np.exp(-t / 0.12)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)) * np.exp(-t / 1.1) * np.minimum(1, t / 0.003)
    body = np.sin(2 * np.pi * 146.8 * t) * np.exp(-t / 0.35) * 0.5 + np.sin(2 * np.pi * 220 * t) * np.exp(-t / 0.25) * 0.25
    puff = noise_band(n, np.full(n, 80.0), np.full(n, 2500.0)) * np.exp(-t / 0.18)
    hit = (sub * 0.5 + body * 0.35 + puff * 0.35)
    place(dry, TITLE_AT, hit, 0)
    place(send, TITLE_AT, hit * 0.6, 0)

    wet = convolve(send, reverb_ir(5.0, 4.2, 7))
    mix = dry + wet * 0.55
    mix = high_pass(mix, 32)
    mix = low_shelf_cut(mix, 7000, -4)

    # the build: the whole piece swells about 8 dB from the first bar to the title
    tt = t_axis(N)
    x = np.clip(tt / TITLE_AT, 0, 1)
    mix *= 10 ** ((-8 + 8 * x * x * (3 - 2 * x)) / 20)

    # fade in (a breath) and out (with the picture)
    fade = np.ones(N)
    fi = int(0.08 * SR)
    fade[:fi] = np.linspace(0, 1, fi)
    fo = int(FADE_OUT * SR)
    fade[-fo:] = np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    mix *= fade

    # master: a soft knee above -6 dBFS, then the peak at -1 dBFS (never clips)
    peak = np.abs(mix).max()
    mix = mix / peak
    knee = 0.5
    over = np.abs(mix) > knee
    mix[over] = np.sign(mix[over]) * (knee + (1 - knee) * np.tanh((np.abs(mix[over]) - knee) / (1 - knee)))
    mix *= 10 ** (-1 / 20) / np.abs(mix).max()

    rms = np.sqrt((mix ** 2).mean())
    phone = high_pass(mix, 150)
    print(f'{out}: {LENGTH:.2f} s, peak -1.0 dBFS, rms {20 * np.log10(rms):.1f} dBFS, '
          f'above 150 Hz alone: rms {20 * np.log10(np.sqrt((phone ** 2).mean())):.1f} dBFS')
    pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'score.wav')
