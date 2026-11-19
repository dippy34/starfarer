/**
 * Play mode — intentionally not implemented yet.
 *
 * This file only registers the "Coming soon" entry so that the start screen
 * shows it and the mode system is exercised with more than one mode. When
 * Play is built it will provide a `create` factory here (story, creatures,
 * friends), attaching its data to the stable object ids every universe
 * object already carries. No other part of the app needs to change.
 */
import { modes } from '../registry';

modes.register({
  id: 'play',
  title: 'Play',
  tagline: 'Story, creatures and friends',
  icon: '🪐',
  available: false,
  order: 2,
});
