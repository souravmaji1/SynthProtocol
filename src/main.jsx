import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { HWBridgeProvider } from '@buidlerlabs/hashgraph-react-wallets';
import { HashpackConnector } from '@buidlerlabs/hashgraph-react-wallets/connectors';
import { HederaTestnet, HederaMainnet } from '@buidlerlabs/hashgraph-react-wallets/chains';

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'


const metadata = {
  name: 'SynthProtocol',
  description: 'SynthProtocol',
  icons: ['https://media.discordapp.net/attachments/1304050235529629726/1319791530583658549/PFP_Textura.png?ex=67863a65&is=6784e8e5&hm=473a628ea826f7d46c9a3bd87eea4d56216b5ce585348814e4d29625c6aa1463&=&format=webp&quality=lossless'],
  url: window.location.href,
};

import { Buffer } from "buffer";

window.Buffer = Buffer;

createRoot(document.getElementById('root')).render(
  <StrictMode>
      <HWBridgeProvider
      metadata={metadata}
      projectId={'cf5f905105402b8b39430d5546a0add6'} // Replace with your own Project ID
      connectors={[HashpackConnector]}
      chains={[HederaTestnet]}
    >
    
    <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
       
                  
        </Routes>
      </BrowserRouter>

    </HWBridgeProvider>
  </StrictMode>,
)

