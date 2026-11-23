"""The cut: tempo, shots in order, text cards. edit.py and score.py both read it.

Everything sits on the score's grid: 80 beats a minute, four beats to a bar, so a beat is 0.75 s and
a bar 3 s. Cuts and text fall on beats (a beat is 22.5 frames at 30 fps: a cut lands on the nearer
frame).
"""

BPM = 80
BEAT = 60 / BPM          # 0.75 s
BAR = 4 * BEAT           # 3 s
FPS = 30


def b(n):
    """time (s) of beat `n` (from 0)"""
    return n * BEAT


# Shots in order: (shot id, start in the trailer, end, first frame of the shot's footage to use,
# transition in: ('cut',) | ('dissolve', seconds) | ('fade', seconds) from black).
# A dissolve runs the outgoing shot on past its end, so that shot needs that much more footage.
CUTS = [
    # the places: the Sun, Saturn, then a beat each for a nebula and a galaxy
    ('sun',       b(0),  b(3),  0, ('fade', 0.25)),
    ('saturn',    b(3),  b(7),  0, ('dissolve', 0.375)),
    ('orion',     b(7),  b(9),  0, ('cut',)),
    ('andromeda', b(9),  b(11), 0, ('cut',)),
    # the ship: from behind, at Jupiter; then flown on a phone: the thrust lever, the torch, the cockpit
    ('chase',     b(11), b(14), 0, ('cut',)),
    ('ship',      b(14), b(20), 0, ('cut',)),
    # a black hole: M87*, from a point to its disk
    ('m87',       b(20), b(26), 0, ('cut',)),
    # god mode, on a phone's screen: the Moon thrown like a slingshot; a world added, grown and put in
    # place; Mars thrown at the Earth (the fall, cut across, then time slowed, the flash and the card)
    ('throw',     b(26), b(35), 0, ('cut',)),
    ('place',     b(35), b(47), 0, ('cut',)),
    ('hit',       b(47), b(52), 0, ('cut',)),
    ('hit',       b(52), b(58), 190, ('dissolve', 0.375)),
    # the pull-out, with a cross-fade inside it: from the star field straight to the moment the
    # whole Milky Way is in view, past the kiloparsecs where the app's glow of the galaxy, seen
    # from inside and close by, is a soft low-resolution wash (see README)
    ('pullout',   b(58), b(64), 0, ('dissolve', 0.375)),
    ('pullout',   b(64), b(72), 178, ('dissolve', 0.375)),
]
LENGTH = b(72)           # 54 s
FADE_OUT = 1.5           # to black at the end (picture and sound)
TITLE_AT = b(66)         # the title card lands here (the score's low hit)
# for the score: when the fusion torch burns on screen (the lever slid up, half a second into the
# ship shot, until the cut); when the Moon is let go (3.3 s into the throw shot's footage); when Done
# is tapped (6.5 s into the place shot's); when time slows for the last of Mars's fall (the start of
# the hit's second part) and when Mars and the Earth meet (the flash: frame 238 of the shot's footage)
TORCH = (b(14) + 0.5, b(20))
THROW_AT = b(26) + 3.3
PLACE_AT = b(35) + 6.5
SLOW_AT = b(52)
HIT_AT = b(52) + (238 - 190) / FPS

# Text cards: (start, end, style, lines). Styles are in edit.py. Nothing in the top 12 % or
# the bottom 20 % of the frame (social apps cover those).
TEXT = [
    (0.3, b(3.4), 'line', ['The real universe.']),
    (b(3.6), b(6.9), 'line', ['Every planet', 'where it really is.']),
    (b(7.1), b(8.9), 'name', ['The Orion Nebula']),
    (b(9.1), b(10.9), 'name', ['The Andromeda Galaxy']),
    (b(11.25), b(13.9), 'line', ['Fly your own ship.']),
    (b(20.4), b(25.9), 'line', ['Black holes,', 'up close.']),
    (b(22), b(25.9), 'name', ['M87*']),
    # god mode: a few words over the quiet sky before the finger comes down (the sky is then the point)
    (b(26.1), b(27.9), 'plate', ['Throw the Moon.']),
    (b(35.05), b(36.4), 'plate_hi', ['Add a world.']),
    (b(47.1), b(48.9), 'plate', ['Throw Mars', 'at the Earth.']),
    (b(59), b(64.5), 'line', ['From Earth', 'to the whole Milky Way.']),
    (TITLE_AT, LENGTH, 'title', ['STARFARER']),
    (b(67.5), LENGTH, 'tagline', ['Real data. Real physics.', 'Free. In your browser.', 'Nothing to install.']),
    (b(69), LENGTH, 'url', ['dippy34.github.io/starfarer']),
]
