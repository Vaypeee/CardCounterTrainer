/* Entry for the static content pages (guide, Hi-Lo, systems): theme toggle + calculator. */
import { $ } from '../dom.js';
import { bindThemeToggle } from '../theme.js';
import { initCalc } from '../ui/help.js';

bindThemeToggle($('#themeBtn'));
initCalc();
