import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import ProjectDialog from '../src/ProjectDialog';
import { createEmptyProject } from '../src/engine/workflow';
describe('project entry workflow',()=>{
 it('starts at home without allocating demo audio or mounting an editing timeline',()=>{
  const audio=vi.fn(()=>{throw new Error('Demo audio must not be allocated on startup');});vi.stubGlobal('AudioBuffer',audio);
  try{const html=renderToStaticMarkup(<I18nProvider><App/></I18nProvider>);expect(html).toContain('Створити проєкт');expect(html).toContain('Відкрити демо');expect(html).not.toContain('<canvas');expect(html).not.toContain('timeline-clip');expect(audio).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
 });
 it('keeps an existing custom resolution in project settings',()=>{const project=createEmptyProject({width:1280,height:720,name:'Interview'});const html=renderToStaticMarkup(<I18nProvider><ProjectDialog mode="settings" project={project} hasPrevious={false} onSubmit={()=>{}} onClose={()=>{}} onBackup={()=>{}}/></I18nProvider>);expect(html).toContain('1280 × 720');expect(html).toContain('Поточний формат');expect(html).toContain('aria-pressed="true"');});
});
