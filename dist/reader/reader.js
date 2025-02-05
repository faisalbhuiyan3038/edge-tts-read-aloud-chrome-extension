(()=>{"use strict";new class{constructor(){this.title=document.querySelector(".reader-title"),this.metadata=document.querySelector(".reader-metadata"),this.content=document.querySelector(".reader-content"),this.errorMessage=document.querySelector(".error-message"),this.pauseButton=document.getElementById("pauseButton"),this.resumeButton=document.getElementById("resumeButton"),this.stopButton=document.getElementById("stopButton"),this.setupMessageListener(),this.setupControlButtons(),this.setupClickToRead()}setupClickToRead(){if(!document.querySelector("#sentence-styles")){const e=document.createElement("style");e.id="sentence-styles",e.textContent="\n        [data-sentence-index] {\n          cursor: pointer;\n        }\n        [data-sentence-index]:hover {\n          background-color: rgba(0, 0, 0, 0.05);\n        }\n      ",document.head.appendChild(e)}this.content.addEventListener("click",(e=>{const t=e.target.closest("[data-sentence-index]");if(t){const e=parseInt(t.getAttribute("data-sentence-index")||"-1",10);e>=0&&(console.log("Clicked sentence index:",e),chrome.runtime.sendMessage({action:"readFromIndex",index:e}).catch((e=>{console.error("Failed to start reading from index:",e),this.showError("Failed to start reading from selected sentence")})))}}))}setupMessageListener(){chrome.runtime.onMessage.addListener(((e,t,s)=>{console.log("Reader received message:",e);try{switch(e.action){case"updateContent":this.updateContent(e.content,e.title,e.metadata),s({status:"success"});break;case"readingStarted":this.enableControls(),s({status:"success"});break;case"readingStopped":this.disableControls(),s({status:"success"});break;case"error":this.showError(e.error),s({status:"success"});break;default:s({status:"error",error:"Unknown action"})}}catch(e){console.error("Error handling message:",e),s({status:"error",error:e instanceof Error?e.message:"Unknown error"})}return!1}))}setupControlButtons(){this.pauseButton.addEventListener("click",(()=>{chrome.runtime.sendMessage({action:"pauseReading"}),this.pauseButton.disabled=!0,this.resumeButton.disabled=!1})),this.resumeButton.addEventListener("click",(()=>{chrome.runtime.sendMessage({action:"resumeReading"}),this.resumeButton.disabled=!0,this.pauseButton.disabled=!1})),this.stopButton.addEventListener("click",(()=>{chrome.runtime.sendMessage({action:"stopReading",closeReader:!0}),this.disableControls()}))}updateContent(e,t,s){this.title.textContent=t||"Reader View";let n="";s&&(s.author&&(n+=`<p class="author">By ${s.author}</p>`),s.siteName&&(n+=`<p class="site-name">From ${s.siteName}</p>`),s.excerpt&&(n+=`<p class="excerpt">${s.excerpt}</p>`)),this.metadata.innerHTML=n,this.content.innerHTML=e;let r=0;const o=[],a=document.createTreeWalker(this.content,NodeFilter.SHOW_TEXT,{acceptNode:function(e){return"SCRIPT"===e.parentElement?.tagName||"STYLE"===e.parentElement?.tagName?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});let i;for(;i=a.nextNode();)o.push(i);o.forEach((e=>{const t=(e.textContent||"").split(/(?<=[.!?])\s+/);if(t.length>0&&e.parentNode){const s=document.createDocumentFragment();t.forEach((e=>{if(e.trim()){const t=document.createElement("span");t.setAttribute("data-sentence-index",r.toString()),t.textContent=e+" ",s.appendChild(t),r++}})),e.parentNode.replaceChild(s,e)}})),this.hideError(),this.enableControls()}enableControls(){this.pauseButton.disabled=!1,this.stopButton.disabled=!1,this.resumeButton.disabled=!0}disableControls(){this.pauseButton.disabled=!0,this.resumeButton.disabled=!0,this.stopButton.disabled=!0}showError(e){this.errorMessage.textContent=e,this.errorMessage.style.display="block",setTimeout((()=>this.hideError()),5e3)}hideError(){this.errorMessage.style.display="none",this.errorMessage.textContent=""}}})();