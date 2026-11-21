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
    ('jupiter',   bar(2, 2),  bar(3, 2),  0, ('cut',)),
    # one half bar each
    ('mars',      bar(3, 2),  bar(4),     0, ('cut',)),
    ('comet',     bar(4),     bar(4, 2),  0, ('cut',)),
    ('orion',     bar(4, 2),  bar(5),     0, ('cut',)),
    ('andromeda', bar(5),     bar(5, 2),  0, ('cut',)),
    # black holes: M87* from a point to its disk, then Cygnus X-1 and its blue supergiant
    ('m87',       bar(5, 2),  bar(7),     0, ('cut',)),
    ('cygnus',    bar(7),     bar(7, 2),  0, ('cut',)),
    ('ui',        bar(7, 2),  bar(9),     0, ('dissolve', 0.375)),
    ('live',      bar(9),     bar(11, 2), 0, ('cut',)),
    # the pull-out, with a cross-fade inside it: from the star field straight to the moment the
    # whole Milky Way is in view, past the kiloparsecs where the app's glow of the galaxy goes
    # white when looked at from close by (see README)
    ('pullout',   bar(11, 2), bar(13),    0, ('dissolve', 0.375)),
    ('pullout',   bar(13),    bar(15),    178, ('dissolve', 0.5)),
]
LENGTH = bar(15)         # 45 s
FADE_OUT = 1.5           # to black at the end (picture and sound)
TITLE_AT = bar(13, 2)    # the title card lands here (the score's low hit)

# Text cards: (start, end, style, lines). Styles are in edit.py. Nothing in the top 12 % or
# the bottom 20 % of the frame (social apps cover those).
TEXT = [
    (bar(0, 2), bar(1, 1.7), 'line', ['The real universe.']),
    (bar(1, 2.5), bar(2, 1.7), 'line', ['Every planet', 'where it really is.']),
    (bar(2, 2.5), bar(3, 1.7), 'line', ['Speed up time.']),
    (bar(3, 2.1), bar(3, 3.9), 'name', ['Mars']),
    (bar(4, 0.1), bar(4, 1.9), 'name', ['A comet']),
    (bar(4, 2.1), bar(4, 3.9), 'name', ['The Orion Nebula']),
    (bar(5, 0.1), bar(5, 1.9), 'name', ['The Andromeda Galaxy']),
    (bar(5, 2.5), bar(7, 1.7), 'line', ['Black holes,', 'up close.']),
    (bar(6, 0), bar(6, 3.9), 'name', ['M87*']),
    (bar(7, 0.1), bar(7, 1.9), 'name', ['Cygnus X-1']),
    (bar(7, 3), bar(8, 3.5), 'top', ['Tap anything.', 'Go there.']),
    (bar(9, 0.25), bar(9, 2.8), 'line', ['Change a world,', 'and gravity takes over.']),
    (bar(9, 3), bar(11, 1.5), 'line', ['Make Jupiter a thousand', 'times heavier.']),
    (bar(11, 3), bar(13, 1.5), 'line', ['From Earth', 'to the whole Milky Way.']),
    (TITLE_AT, LENGTH, 'title', ['STARFARER']),
    (bar(13, 3.5), LENGTH, 'tagline', ['Free. In your browser.', 'Nothing to install.']),
    (bar(14, 1), LENGTH, 'url', ['dippy34.github.io/starfarer']),
]
