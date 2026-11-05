import { render } from 'preact';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import './styles.css';
import { App } from './app';
import { failureMessage, init } from './store';
import { registerServiceWorker } from './update';

const root = document.getElementById('app');
if (!root) throw new Error("Muster's page has no #app element to start in");
render(<App />, root);
init().catch((e: unknown) => render(<p class="error-text pad">{failureMessage('open Muster', e)}</p>, root));
registerServiceWorker();
