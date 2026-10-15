/* Beta onboarding only: never reads or writes garage records. */
(function(){
  'use strict';
  var KEY='ride-garage-beta-welcome-v1';
  var overlay=null;
  var previousFocus=null;
  var previousOverflow='';
  function seen(){
    try{return localStorage.getItem(KEY)==='1'}catch(e){return false}
  }
  function remember(){
    try{localStorage.setItem(KEY,'1')}catch(e){}
  }
  function mount(){
    if(overlay)return overlay;
    overlay=document.createElement('div');
    overlay.id='rg-welcome';
    overlay.className='rgw-backdrop';
    overlay.hidden=true;
    overlay.innerHTML=[
      '<section class="rgw-panel" role="dialog" aria-modal="true" aria-labelledby="rgw-title" aria-describedby="rgw-description">',
        '<button type="button" class="rgw-close" data-rgw-close aria-label="Close welcome guide">&times;</button>',
        '<span class="rgw-eyebrow">Ride Garage beta / Free access</span>',
        '<img class="rgw-logo" src="ride-garage-premium-logo.png" alt="Ride Garage">',
        '<h2 class="rgw-title" id="rgw-title">Every ride has a story.<br><em>Keep yours together.</em></h2>',
        '<p class="rgw-description" id="rgw-description">Your personal motorcycle garage for builds, upkeep, and rides. Start with a bike, explore the tools, and help shape Ride Garage as a beta tester.</p>',
        '<div class="rgw-steps" aria-label="Three steps to get started">',
          '<div class="rgw-step"><span class="rgw-number">01</span><strong>Add your motorcycle</strong><p>Enter your bike in Garage to create your garage.</p></div>',
          '<div class="rgw-step"><span class="rgw-number">02</span><strong>Keep a history</strong><p>Record mods, maintenance, fuel and costs as you go.</p></div>',
          '<div class="rgw-step"><span class="rgw-number">03</span><strong>Ride &amp; connect</strong><p>Log trips, save places and explore the rider community.</p></div>',
        '</div>',
        '<div class="rgw-actions">',
          '<button type="button" class="rgw-primary" data-rgw-start>Add my motorcycle <span aria-hidden="true">&rarr;</span></button>',
          '<button type="button" class="rgw-secondary" data-rgw-explore>Explore first</button>',
        '</div>',
        '<div class="rgw-footer"><span>No payment required. Garage records stay on this device.</span><a href="feedback.html" data-rgw-feedback>Report a bug or share an idea &nearr;</a></div>',
      '</section>'
    ].join('');
    document.body.appendChild(overlay);
    overlay.querySelector('[data-rgw-close]').addEventListener('click',function(){finish()});
    overlay.querySelector('[data-rgw-explore]').addEventListener('click',function(){finish()});
    overlay.querySelector('[data-rgw-start]').addEventListener('click',function(){finish('build')});
    overlay.querySelector('[data-rgw-feedback]').addEventListener('click',remember);
    return overlay;
  }
  function onKeydown(event){
    if(!overlay||overlay.hidden)return;
    if(event.key==='Escape'){event.preventDefault();finish();return}
    if(event.key!=='Tab')return;
    var elements=Array.prototype.slice.call(
      overlay.querySelectorAll('button:not([disabled]),a[href]')
    );
    if(!elements.length)return;
    var first=elements[0],last=elements[elements.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  function finish(destination){
    if(!overlay||overlay.hidden)return;
    remember();
    overlay.hidden=true;
    document.body.style.overflow=previousOverflow;
    document.removeEventListener('keydown',onKeydown);
    if(destination==='build'&&typeof window.tab==='function'){
      window.tab('build');
      var bikeInput=document.getElementById('bk');
      if(bikeInput)bikeInput.focus({preventScroll:true});
    }else if(previousFocus&&document.contains(previousFocus)&&typeof previousFocus.focus==='function'){
      previousFocus.focus({preventScroll:true});
    }
    previousFocus=null;
  }
  window.showRideGarageWelcome=function(){
    if(!document.body)return;
    var element=mount();
    if(!element.hidden)return;
    previousFocus=document.activeElement;
    previousOverflow=document.body.style.overflow;
    element.hidden=false;
    document.body.style.overflow='hidden';
    document.addEventListener('keydown',onKeydown);
    element.querySelector('[data-rgw-start]').focus({preventScroll:true});
  };
  window.initRideGarageWelcome=function(savedGarage){
    // Existing users must never be interrupted or have their data changed.
    if(savedGarage!=null||seen())return;
    requestAnimationFrame(function(){window.showRideGarageWelcome()});
  };
})();