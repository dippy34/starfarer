"""The cut: tempo, shots in order, text cards. edit.py and score.py both read it.

Everything sits on the score's grid: 80 beats a minute, four beats to a bar, so a bar is 3 s
(90 frames at 30 fps). Cuts fall on bars and half bars, text on beats.
"""

BPM = 80
BEAT = 60 / BPM          # 0.75 s
BAR = 4 * BEAT           # 3 s
FPS = 30


def bar(n, beat=0):
    """time (s) of bar `n` (from 0), plus `beat` beats"""
    return n * BAR + beat * BEAT


# Shots in order: (shot id, start in the trailer, end, first frame of the shot's footage to use,
# transition in: ('cut',) | ('dissolve', seconds) | ('fade', seconds) from black).
# A dissolve runs the outgoing shot on past its end, so that shot needs that much more footage.
CUTS = [
    ('sun',       bar(0),     bar(1, 2),  0, ('fade', 0.25)),
    ('saturn',    bar(1, 2),  bar(2, 2),  0, ('dissolve', 0.375)),
    # one half bar each
    ('titan',     bar(2, 2),  bar(3),     0, ('cut',)),
    ('orion',     bar(3),     bar(3, 2),  0, ('cut',)),
    ('andromeda', bar(3, 2),  bar(4),     0, ('cut',)),
    # the ship: from behind, at Jupiter; then flown on a phone: the thrust lever, the torch, the cockpit
    ('chase',     bar(4),     bar(5),     0, ('cut',)),
    ('ship',      bar(5),     bar(6, 2),  0, ('cut',)),
    # black holes: M87* from a point to its disk, then Cygnus X-1 and its blue supergiant
    ('m87',       bar(6, 2),  bar(8),     0, ('cut',)),
    ('cygnus',    bar(8),     bar(8, 2),  0, ('cut',)),
    # god mode: a second sun (on a phone's screen, then from over the planets), then Jupiter
    # twenty times heavier, on a phone's screen: its start, and the moment Europa hits
    ('sun2',      bar(8, 2),  bar(9, 3),  6, ('dissolve', 0.375)),
    ('sunlive',   bar(9, 3),  bar(11),    7, ('cut',)),
    ('europa',    bar(11),    bar(12),    12, ('cut',)),
    ('europa',    bar(12),    bar(13),    291, ('dissolve', 0.375)),
    # the pull-out, with a cross-fade inside it: from the star field straight to the moment the
    # whole Milky Way is in view, past the kiloparsecs where the app's glow of the galaxy, seen
    # from inside and close by, is a soft low-resolution wash (see README)
    ('pullout',   bar(13),    bar(14, 2), 0, ('dissolve', 0.375)),
    ('pullout',   bar(14, 2), bar(16, 2), 178, ('dissolve', 0.375)),
]
LENGTH = bar(16, 2)      # 49.5 s
FADE_OUT = 1.5           # to black at the end (picture and sound)
TITLE_AT = bar(15)       # the title card lands here (the score's low hit)
# for the score: when the fusion torch burns on screen (the lever slid up, half a second into the
# ship shot, until the cut), and when the second sun appears (1 s into its shot: frame 30, from 7)
TORCH = (bar(5) + 0.5, bar(6, 2))
SUN2_AT = bar(9, 3) + (30 - 7) / FPS

# Text cards: (start, end, style, lines). Styles are in edit.py. Nothing in the top 12 % or
# the bottom 20 % of the frame (social apps cover those).
TEXT = [
    (bar(0, 2), bar(1, 1.7), 'line', ['The real universe.']),
    (bar(1, 2.5), bar(2, 1.7), 'line', ['Every planet', 'where it really is.']),
    (bar(2, 2.1), bar(2, 3.9), 'name', ['Titan']),
    (bar(3, 0.1), bar(3, 1.9), 'name', ['The Orion Nebula']),
    (bar(3, 2.1), bar(3, 3.9), 'name', ['The Andromeda Galaxy']),
    (bar(4, 0.25), bar(4, 3.7), 'line', ['Fly your own ship.']),
    (bar(6, 2.5), bar(8, 1.7), 'line', ['Black holes,', 'up close.']),
    (bar(7, 0), bar(7, 3.9), 'name', ['M87*']),
    (bar(8, 0.1), bar(8, 1.9), 'name', ['Cygnus X-1']),
    (bar(9, 3.25), bar(10, 3.6), 'line', ['Add a second sun.']),
    (bar(11, 0.1), bar(11, 2.0), 'plate', ['Make Jupiter', 'twenty times heavier.']),
    (bar(13, 1), bar(14, 2.5), 'line', ['From Earth', 'to the whole Milky Way.']),
    (TITLE_AT, LENGTH, 'title', ['STARFARER']),
    (bar(15, 1.5), LENGTH, 'tagline', ['Free. In your browser.', 'Nothing to install.']),
    (bar(15, 3), LENGTH, 'url', ['dippy34.github.io/starfarer']),
]
