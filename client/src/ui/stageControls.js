import { h, clear, num } from '../dom.js';
import { store, updateSlot, setStatus } from '../store.js';
import { t, register, getLang } from '../i18n.js';

register('en', {
  'Bühnenbild': 'Stage design', 'Wände & Panels': 'Walls & panels',
  'Bühnenansicht': 'Stage view', 'Darstellung': 'Appearance', 'Theater': 'Theatre', 'Technik': 'Technical',
  'Bühnenraum': 'Theatre surround', 'Licht am Boden': 'Floor light',
  'Testbild für leere Wände': 'Test pattern on empty walls', 'Prüfhilfen': 'Inspection tools',
  'LED-Oberfläche': 'LED surface', 'Haus & Ausgabe': 'Venue & output', 'Pixelraster': 'Pixel dimensions',
  'Bühnenbreite': 'Wall width', 'Bildrate': 'Frame rate', 'Pixelabstand': 'Pixel pitch',
  'Abstände nach Guide. Portal, Licht und Fahrwege sind eine räumliche Annäherung.':
    'Spacing follows the guide. Proscenium, lighting and travel are indicative.',
  'Bühnenraum und Fahrwege sind eine räumliche Annäherung.': 'Theatre surround and travel are indicative.',
  'Die Darstellung verändert keine Lieferdatei.': 'Appearance settings do not change delivery files.',
  'Bild speichern': 'Save image', 'Ansicht vergrößern': 'Expand view',
  'Wände': 'Walls', 'Einstellungen': 'Settings', 'Auswahl': 'Selection',
  'Wieder koppeln': 'Recouple', 'Auswahl leeren': 'Clear selection',
  'Ziehen: Kamera · Mausrad: Zoom · Panel ziehen: Fahrweg': 'Drag: camera · wheel: zoom · drag panel: travel',
  'Vorschau mit Testbild': 'Test-pattern preview', 'Live-Vorschau': 'Live preview',
  'Material hinzufügen': 'Add footage', 'Nähte': 'Seams', 'Sperrzonen': 'Safe areas',
  'Sichtgrenzen': 'Sightlines', 'Raster': 'Grid', 'Drahtgitter': 'Wireframe',
  'Figur': 'Figure', 'Boden': 'Floor', 'LED-Look': 'LED look',
  'Helligkeit': 'Brightness', 'Schwarz': 'Black level', 'Rahmen': 'Bezel', 'Umgebung': 'Ambient',
  'Kamera': 'Camera', 'Alle Panels wieder gekoppelt.': 'All panels recoupled.',
  'Foto konnte nicht gespeichert werden.': 'The snapshot could not be saved.',
  'Einstellungen schließen': 'Close settings',
});

const LOOKS = {
  theatre: { stage: { showScenery:true, showFloor:true, showReflections:true, showFigure:true, ledRealism:true, ambient:.15 }, overlays: { seams:false, grid:false, sightlines:false, wireframe:false, safeArea:false } },
  technical: { stage: { showScenery:false, showFloor:true, showReflections:false, showFigure:true, ledRealism:false, ambient:.45 }, overlays: { seams:true, grid:true, sightlines:true, wireframe:false, safeArea:false } },
};

/** Stable controls: updates never replace the focused slider or the camera picker. */
export function createStageControls(getStage) {
  const el = h('div.stage-settings#stageSettings');
  const bar = document.getElementById('stageBar');
  const hud = document.getElementById('stageHud');
  const hint = document.getElementById('stageHint');
  let structureKey = '';
  let controls = [];
  let lookButtons = [];
  let camera, specs, selection, selectionText, recouple, clearSelection, hudTitle, hudMeta, hudMode, addFootage;

  function toggle(group, key, label) {
    const input = h('input', {type:'checkbox', 'aria-label':t(label)});
    input.addEventListener('change', () => store.set({ui:{[group]:{[key]:input.checked}}}));
    controls.push({input,group,key});
    return h('label.setting-toggle', h('span',t(label)), input);
  }

  function range(key,label,min,max,step,format) {
    const input = h('input',{type:'range',min,max,step,'aria-label':t(label)});
    const output = h('output');
    input.addEventListener('input',()=>store.set({ui:{stage:{[key]:Number(input.value)}}}));
    controls.push({input,output,group:'stage',key,format});
    return h('label.setting-range',h('span',t(label)),output,input);
  }

  function section(label,...nodes) { return h('section.setting-section',h('h3',t(label)),...nodes); }
  function button(label,fn,props={}) { return h('button.btn.sm',{type:'button',onClick:fn,...props},t(label)); }

  function build(state) {
    clear(el); clear(bar); clear(hud); clear(hint); controls=[];lookButtons=[];
    el.appendChild(h('div.panel-heading',h('div.eyebrow','STAGE STUDIO'),
      h('div.row',h('h2',t('Darstellung')),button('×',()=>document.body.classList.remove('settings-open'),
        {class:'btn sm ghost stage-drawer-close','aria-label':t('Einstellungen schließen')}))));
    const looks=h('div.look-switch');
    for (const [id,label] of [['theatre','Theater'],['technical','Technik']]) {
      const btn=button(label,()=>store.set({ui:LOOKS[id]}));
      lookButtons.push({btn,id});looks.appendChild(btn);
    }
    el.appendChild(section('Bühnenansicht', looks,
      toggle('stage','showScenery','Bühnenraum'),toggle('stage','showFloor','Boden'),
      toggle('stage','showReflections','Licht am Boden'),toggle('stage','showFigure','Figur'),
      toggle('stage','testPattern','Testbild für leere Wände')));
    el.appendChild(section('Prüfhilfen',h('div.grid2',
      ...[['seams','Nähte'],['safeArea','Sperrzonen'],['grid','Raster'],['sightlines','Sichtgrenzen']].map(([key,label])=>toggle('overlays',key,label))),
      toggle('overlays','wireframe','Drahtgitter')));
    el.appendChild(section('LED-Oberfläche',toggle('stage','ledRealism','LED-Look'),
      range('brightness','Helligkeit',0,2,.01,v=>`${Math.round(v*100)} %`),
      range('ambient','Umgebung',0,1,.01,v=>`${Math.round(v*100)} %`),
      range('blackLift','Schwarz',0,.2,.005,v=>`${num(v*100,1)} %`),
      range('bezel','Rahmen',0,2,.05,v=>`${num(v,2)} px`),
      h('p',t('Die Darstellung verändert keine Lieferdatei.'))));
    specs=h('dl.spec-grid');
    el.appendChild(section('Haus & Ausgabe',specs,h('p.quiet-note',t(state.venue?.id==='mein-schiff-theater'
      ? 'Abstände nach Guide. Portal, Licht und Fahrwege sind eine räumliche Annäherung.'
      : 'Bühnenraum und Fahrwege sind eine räumliche Annäherung.'))));
    selectionText=h('span');
    clearSelection=button('Auswahl leeren',()=>store.set({ui:{selectedPanels:[]}}));
    recouple=button('Wieder koppeln',()=>{
      for(const [wallId,wall] of Object.entries(store.get().project?.walls||{}))
        for(const [slotId,slot] of Object.entries(wall.slots||{}))
          if(slot.travelOverrideM!=null) updateSlot(wallId,slotId,{travelOverrideM:null});
      setStatus(t('Alle Panels wieder gekoppelt.'),'ok');
    });
    selection=section('Auswahl',selectionText,h('div.selection-summary',clearSelection,recouple));el.appendChild(selection);
    bar.appendChild(button('Wände',()=>document.body.classList.toggle('walls-open'),{id:'stageWallsToggle',style:'display:none'}));
    bar.appendChild(h('span.toolbar-title',t('Bühnenansicht')));
    camera=h('select',{'aria-label':t('Kamera')},...(state.venue?.camera?.presets||[]).map(p=>h('option',{value:p.id},p.label)));
    camera.addEventListener('change',()=>{
      store.set({ui:{stage:{cameraPreset:camera.value}}});
      getStage()?.setCamera(camera.value);
    });
    bar.appendChild(camera);
    bar.appendChild(h('div.toolbar-actions',
      button('Einstellungen',()=>document.body.classList.toggle('settings-open'),{id:'stageSettingsToggle',style:'display:none'}),
      button('Bild speichern',()=>{
        try {
          const url=getStage()?.screenshot(); if(!url) throw new Error('No viewport');
          const a=h('a',{href:url,download:`buehne_${new Date().toISOString().replace(/[:.]/g,'-')}.png`});
          document.body.appendChild(a);a.click();a.remove();
        }catch {setStatus(t('Foto konnte nicht gespeichert werden.'),'err');}
      }),
      button('⛶',()=>{document.body.classList.toggle('viewport-full');window.dispatchEvent(new Event('resize'));},
        {title:t('Ansicht vergrößern'),'aria-label':t('Ansicht vergrößern')})));
    hudMode=h('div.eyebrow');hudTitle=h('strong');hudMeta=h('span');hud.append(hudMode,hudTitle,hudMeta);
    addFootage=button('Material hinzufügen',()=>store.set({ui:{view:'library'}}));
    hint.append(h('span',t('Ziehen: Kamera · Mausrad: Zoom · Panel ziehen: Fahrweg')),addFootage);
  }

  function update(state) {
    const key=JSON.stringify([getLang(),state.venue?.id,state.venue?.camera]);
    if(key!==structureKey){structureKey=key;build(state);}
    for(const {input,output,group,key,format} of controls){
      const value=state.ui[group]?.[key];
      if(input.type==='checkbox') input.checked=!!value;
      else {if(document.activeElement!==input) input.value=String(value??0);output.textContent=format(value??0);}
    }
    for(const {btn,id} of lookButtons){
      const active=Object.entries(LOOKS[id]).every(([group,values])=>Object.entries(values).every(([key,value])=>state.ui[group]?.[key]===value));
      btn.classList.toggle('on',active);btn.setAttribute('aria-pressed',String(active));
    }
    camera.value=state.ui.stage.cameraPreset;
    const wall=state.venue?.walls?.find(w=>w.id===state.ui.activeWallId);
    clear(specs);
    for(const [label,value] of [
      ['Pixelraster',wall?`${wall.width} × ${wall.height}`:'—'],['Bühnenbreite',wall?`${num(wall.widthM,2)} m`:'—'],
      ['Bildrate',`${state.project?.fps||state.venue?.fps||30} fps`],['Pixelabstand',`${num(state.venue?.pixelPitchMm,1)} mm`],
    ]) specs.appendChild(h('div',h('dt',t(label)),h('dd',value)));
    const selected=state.ui.selectedPanels||[];
    const overrides=Object.values(state.project?.walls||{}).flatMap(w=>Object.values(w.slots||{})).filter(s=>s.travelOverrideM!=null).length;
    selection.hidden=!selected.length&&!overrides;
    selectionText.textContent=selected.join(' · ');
    clearSelection.hidden=!selected.length;recouple.hidden=!overrides;
    const hasMedia=Object.values(state.project?.walls||{}).some(w=>Object.values(w.slots||{}).some(s=>s.layers?.some(l=>l.enabled!==false)));
    hudMode.textContent=t(!hasMedia&&state.ui.stage.testPattern?'Vorschau mit Testbild':'Live-Vorschau');
    hudTitle.textContent=state.venue?.name||'—';
    hudMeta.textContent=state.venue?`${state.venue.walls.length} ${t('Wände')} / ${state.venue.walls.reduce((n,w)=>n+w.panels.length,0)} Panels · ${state.venue.fps} fps`:'';
    addFootage.hidden=hasMedia;
  }
  return {el,update};
}
