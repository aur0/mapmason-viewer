import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, X } from 'lucide-react';

export default function ShareMap({name,onClose}:{name:string;onClose:()=>void}) {
  const panel=useRef<HTMLElement>(null),linkInput=useRef<HTMLInputElement>(null);
  const [qr,setQr]=useState(''),[message,setMessage]=useState('');
  const url=new URL(window.location.href);url.hash='';
  const shareable=['https:','http:'].includes(url.protocol)&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const link=url.href;
  useEffect(()=>{
    if(!shareable)return;
    let active=true;
    QRCode.toDataURL(link,{width:640,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}})
      .then(value=>{if(active)setQr(value);}).catch(()=>{if(active)setMessage('Could not generate the QR code. You can still copy the link.');});
    return ()=>{active=false;};
  },[link,shareable]);
  useEffect(()=>{
    const previous=document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const controls=panel.current?.querySelectorAll<HTMLElement>('button,input');
        if(!controls?.length)return;
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',keydown);
    return ()=>{document.removeEventListener('keydown',keydown);if(previous instanceof HTMLElement)previous.focus();};
  },[onClose]);
  const copy=async()=>{
    try{await navigator.clipboard.writeText(link);setMessage('Link copied.');}
    catch{linkInput.current?.focus();linkInput.current?.select();setMessage('Select and copy the link below.');}
  };
  return <section ref={panel} className="visitor-share" role="dialog" aria-modal="true" aria-labelledby="share-title">
    <button className="visitor-share-close" aria-label="Close share page" onClick={onClose}><X size={24}/></button>
    <div className="visitor-share-content"><small>SHARE THIS MAP</small><h1 id="share-title">{name}</h1>
      {shareable?<><p>Scan with your phone camera to open this map.</p>
        {qr?<img className="visitor-share-qr" src={qr} alt={`QR code linking to ${name}`} width="320" height="320"/>:<p role="status">Preparing QR code…</p>}
        <button className="primary" onClick={()=>void copy()}><Copy size={17}/>Copy map link</button>
        <input ref={linkInput} aria-label="Map share link" readOnly value={link} onFocus={event=>event.currentTarget.select()}/>
      </>:<p>This map is opened locally. Host it on a public website, then open that link to show a QR code other people can scan.</p>}
      <p role="status">{message}</p><details className="visitor-privacy"><summary>Privacy &amp; viewer source</summary><p>Your GPS position and phone sensor readings are processed on this device. MapMason does not receive or store them. If street maps are enabled, tile requests reveal the area being viewed to the map provider.</p><a href="https://github.com/aur0/mapmason-viewer" target="_blank" rel="noreferrer">Read the open-source viewer code</a></details>
    </div>
  </section>;
}
