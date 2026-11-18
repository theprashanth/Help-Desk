import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MessengerWidget, { MessengerMode } from '../../components/customer/MessengerWidget';

/**
 * The Messenger as a standalone page:
 *  - /messenger/<appId>                    loaded by messenger.js in an iframe on your website
 *  - /messenger/<appId>?mode=fullscreen    opened in a WebView inside your iOS / Android / React Native app
 */
export const MessengerFrame: React.FC = () => {
  const { appId = '' } = useParams();
  const mode: MessengerMode = new URLSearchParams(window.location.search).get('mode') === 'fullscreen' ? 'fullscreen' : 'embedded';

  useEffect(() => {
    // The iframe must be see-through so only the launcher/panel is visible on the host site
    const prev = { html: document.documentElement.style.background, body: document.body.style.background };
    if (mode === 'embedded') {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
    }
    document.documentElement.classList.remove('dark');
    return () => {
      document.documentElement.style.background = prev.html;
      document.body.style.background = prev.body;
    };
  }, [mode]);

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(appId)) {
    return <div style={{ padding: 24, fontFamily: 'system-ui', color: '#6e6e6a' }}>Unknown Messenger app id.</div>;
  }
  return <MessengerWidget appId={appId} mode={mode} />;
};

export default MessengerFrame;
