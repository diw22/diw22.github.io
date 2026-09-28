/* Local URDF playground; no hardware connection. */
'use strict';
const $=selector=>document.querySelector(selector);
const canvas=$('#environment');
let robotView=null;
try {
  robotView=AeroViewer.create(canvas,window.AERO_ROBOT_DATA);
  window.robotView=robotView;
  $('.empty-state').hidden=true;
} catch(error) {
  console.error(error);
  $('.empty-state h1').textContent='Robot unavailable';
  $('.empty-tag').textContent='Enable WebGL, then reload.';
}
const names=['Base yaw','Shoulder pitch','Elbow pitch','Wrist pitch','Wrist yaw','Wrist roll'];
const ids=['joint1_base_yaw','joint2_shoulder_pitch','joint3_elbow_pitch','joint4_wrist_pitch','joint5_wrist_yaw','joint6_wrist_roll'];
const joints=ids.map((id,i)=>({id,name:names[i],min:Math.round((robotView?.joints[id].lower ?? 0)*180/Math.PI),max:Math.round((robotView?.joints[id].upper ?? 0)*180/Math.PI)}));
const state={angles:joints.map(()=>0),gripper:0,axes:false,playing:false};
const defaultCamera={yaw:-.70,pitch:.22,zoom:.85,top:false};
const camera={...defaultCamera};
let frame=0,drag=null,width=1,height=1;
// Keep the camera centred; CSS moves the transparent robot canvas with the drawer.
function requestRender(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;robotView?.draw(camera,false,state.axes);});}
function jointValues(){
  const values=Object.fromEntries(joints.map((joint,i)=>[joint.id,state.angles[i]*Math.PI/180]));
  const jaw=robotView?.joints.left_jaw_joint;
  values.left_jaw_joint=jaw ? jaw.lower+(jaw.upper-jaw.lower)*state.gripper/100 : 0;
  return values;
}
$('#joint-controls').innerHTML=joints.map((joint,i)=>`<div class="joint-control"><div class="joint-heading"><label for="${joint.id}"><span class="joint-index">J${i+1}</span>${joint.name}</label><output id="value-${i}" for="${joint.id}">0<span>°</span></output></div><input type="range" id="${joint.id}" min="${joint.min}" max="${joint.max}" value="0" step="1"><div class="range-labels"><span>${joint.min}°</span><span>0°</span><span>${joint.max}°</span></div></div>`).join('');
const inputs=joints.map(j=>document.getElementById(j.id));
function setRange(input,value){input.value=value;input.style.setProperty('--fill',`${100*(value-Number(input.min))/(Number(input.max)-Number(input.min))}%`);}
function renderControls(){
  inputs.forEach((input,i)=>{state.angles[i]=Math.max(joints[i].min,Math.min(joints[i].max,state.angles[i]));setRange(input,state.angles[i]);$(`#value-${i}`).innerHTML=`${Math.round(state.angles[i])}<span>°</span>`;});
  setRange($('#gripper'),state.gripper);$('#gripper-value').innerHTML=`${Math.round(state.gripper)}<span>%</span>`;
  robotView?.pose(jointValues());requestRender();
}
function stopPlaying(){state.playing=false;cancelAnimationFrame(animationFrame);animationFrame=0;$('#animate span').textContent='Play';$('#animate use').setAttribute('href','#i-play');$('#animate').setAttribute('aria-pressed','false');}
inputs.forEach((input,i)=>input.addEventListener('input',()=>{stopPlaying();state.angles[i]=Number(input.value);renderControls();}));
$('#gripper').addEventListener('input',e=>{stopPlaying();state.gripper=Number(e.target.value);renderControls();});
$('#reset-joints').addEventListener('click',()=>{stopPlaying();state.angles=joints.map(()=>0);state.gripper=0;renderControls();toast('Pose reset.');});
let animationStart=0,animationFrame=0,animationOrigin=null;
$('#animate').addEventListener('click',()=>{if(state.playing){stopPlaying();return;}stopPlaying();state.playing=true;animationStart=performance.now();animationOrigin={angles:[...state.angles],gripper:state.gripper};$('#animate span').textContent='Pause';$('#animate use').setAttribute('href','#i-pause');$('#animate').setAttribute('aria-pressed','true');animationFrame=requestAnimationFrame(animateControls);});
function animateControls(time){if(!state.playing)return;Object.assign(state,AeroMotion.sample((time-animationStart)/1000,animationOrigin,joints));renderControls();animationFrame=requestAnimationFrame(animateControls);}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlaying();});
function pose(){return {schema:'aero-urdf-pose-v1',model_loaded:!!robotView,model_sha256:window.AERO_ROBOT_DATA.sha256,
  units:'degrees',joint_angles:Object.fromEntries(joints.map((j,i)=>[j.id,state.angles[i]])),
  gripper_open_percent:state.gripper,joint_positions_SI:robotView?.inspect().applied ?? {},
  note:'URDF joint positions: revolute radians, prismatic metres. CAD limits are provisional; not hardware commands.'};}
$('#copy-pose').addEventListener('click',async()=>{const text=JSON.stringify(pose(),null,2);try{await navigator.clipboard.writeText(text);toast('Pose copied.');}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();toast(ok?'Pose copied.':'Could not copy pose.');}});
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600);}
$('#about-button').addEventListener('click',()=>$('#about-dialog').showModal());
document.querySelectorAll('.dialog-close,.dialog-done').forEach(button=>button.addEventListener('click',()=>$('#about-dialog').close()));
$('#about-dialog').addEventListener('click',e=>{if(e.target===$('#about-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;robotView?.resize(width,height);requestRender();}
new ResizeObserver(resize).observe(canvas);
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;camera.yaw-=(e.clientX-drag.x)*.008;camera.pitch=Math.max(.04,Math.min(1.25,camera.pitch+(e.clientY-drag.y)*.005));camera.top=false;$('#camera-mode').firstChild.textContent='Perspective ';drag={x:e.clientX,y:e.clientY};requestRender();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.55,Math.min(2,camera.zoom-e.deltaY*.001));requestRender();},{passive:false});
canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')camera.yaw-=.1;if(e.key==='ArrowRight')camera.yaw+=.1;if(e.key==='ArrowUp')camera.pitch=Math.min(1.25,camera.pitch+.07);if(e.key==='ArrowDown')camera.pitch=Math.max(.04,camera.pitch-.07);if(e.key==='+'||e.key==='=')camera.zoom=Math.min(2,camera.zoom+.1);if(e.key==='-')camera.zoom=Math.max(.55,camera.zoom-.1);requestRender();});
$('#reset-camera').addEventListener('click',()=>{Object.assign(camera,defaultCamera);$('#camera-mode').firstChild.textContent='Perspective ';requestRender();});
$('#camera-mode').addEventListener('click',()=>{camera.top=!camera.top;$('#camera-mode').firstChild.textContent=camera.top?'Top view ':'Perspective ';requestRender();});
$('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen isn’t available in this browser.');}});
const controlsPanel=$('#pose-panel'),controlsToggle=$('#controls-toggle'),controlsRestore=$('#controls-restore');
function setControlsVisible(visible){
  const moveFocus=visible?document.activeElement===controlsRestore:controlsPanel.contains(document.activeElement);
  document.body.classList.toggle('controls-hidden',!visible);
  if(visible){
    controlsPanel.inert=false;
    controlsPanel.setAttribute('aria-hidden','false');
    if(moveFocus)controlsToggle.focus({preventScroll:true});
  }else{
    controlsRestore.inert=false;
    controlsRestore.setAttribute('aria-hidden','false');
    if(moveFocus)controlsRestore.focus({preventScroll:true});
  }
  controlsPanel.inert=!visible;
  controlsPanel.setAttribute('aria-hidden',String(!visible));
  controlsToggle.setAttribute('aria-expanded',String(visible));
  controlsRestore.inert=visible;
  controlsRestore.setAttribute('aria-hidden',String(visible));
  controlsRestore.setAttribute('aria-expanded',String(visible));
}
const compactScreen=matchMedia('(max-width:760px)');
setControlsVisible(!compactScreen.matches);
compactScreen.addEventListener('change',event=>setControlsVisible(!event.matches));
controlsToggle.addEventListener('click',()=>setControlsVisible(false));
controlsRestore.addEventListener('click',()=>setControlsVisible(true));
// Establish the responsive starting state before enabling drawer motion.
requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.add('controls-ready')));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#about-dialog').open&&!controlsPanel.inert){setControlsVisible(false);controlsRestore.focus({preventScroll:true});}});
if(!robotView)document.querySelectorAll('#pose-panel input,#pose-panel button:not(#controls-toggle)').forEach(el=>el.disabled=true);
renderControls();
