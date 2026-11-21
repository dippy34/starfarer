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
    ('sun',       bar(0),     bar(1, 2), 0, ('fade', 0.25)),
    ('earth',     bar(1, 2),  bar(2, 2), 0, ('dissolve', 0.375)),
    ('saturn',    bar(2, 2),  bar(3, 2), 0, ('cut',)),
    ('jupiter',   bar(3, 2),  bar(4, 2), 0, ('cut',)),
    # one beat each, cut on the half bar
    ('mars',      bar(4, 2),  bar(5),    0, ('cut',)),
    ('moon',      bar(5),     bar(5, 2), 0, ('cut',)),
    ('comet',     bar(5, 2),  bar(6),    0, ('cut',)),
    ('orion',     bar(6),     bar(6, 2), 0, ('cut',)),
    ('andromeda', bar(6, 2),  bar(7),    0, ('cut',)),
    ('ui',        bar(7),     bar(9),    0, ('dissolve', 0.375)),
    # the pull-out, with a cross-fade inside it: from the star field straight to the moment the
    # whole Milky Way is in view, past the kiloparsecs where the app's glow of the galaxy goes
    # white when looked at from close by (see README)
    ('pullout',   bar(9),     bar(10, 2), 0, ('dissolve', 0.375)),
    ('pullout',   bar(10, 2), bar(13),    178, ('dissolve', 0.5)),
]
LENGTH = bar(13)         # 39 s
FADE_OUT = 1.5           # to black at the end (picture and sound)
TITLE_AT = bar(11)       # the title card lands here (the score's low hit)

# Text cards: (start, end, style, lines). Styles are in edit.py. Nothing in the top 12 % or
# the bottom 20 % of the frame (social apps cover those).
TEXT = [
    (bar(0, 2), bar(1, 1.7), 'line', ['The real universe.']),
    (bar(1, 2.5), bar(3, 1.7), 'line', ['Every planet', 'where it really is.']),
    (bar(3, 2.5), bar(4, 1.7), 'line', ['Speed up time.']),
    (bar(4, 2.1), bar(4, 3.9), 'name', ['Mars']),
    (bar(5, 0.1), bar(5, 1.9), 'name', ['The Moon']),
    (bar(5, 2.1), bar(5, 3.9), 'name', ['A comet']),
    (bar(6, 0.1), bar(6, 1.9), 'name', ['The Orion Nebula']),
    (bar(6, 2.1), bar(6, 3.9), 'name', ['The Andromeda Galaxy']),
    (bar(7, 0.5), bar(8, 3.5), 'top', ['Tap anything.', 'Go there.']),
    (bar(9, 1), bar(10, 3.5), 'line', ['From Earth', 'to the whole Milky Way.']),
    (TITLE_AT, LENGTH, 'title', ['STARFARER']),
    (bar(11, 1.5), LENGTH, 'tagline', ['Free. In your browser.', 'Nothing to install.']),
    (bar(11, 3), LENGTH, 'url', ['dippy34.github.io/starfarer']),
]
