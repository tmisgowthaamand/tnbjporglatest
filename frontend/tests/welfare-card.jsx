import React from 'react'
import { createRoot } from 'react-dom/client'
import { SchemeWelfareCard } from '../src/pages/ChatbotPage'
import { LanguageProvider, useLang } from '../src/i18n/LanguageContext'
import '../src/index.css'
import '../src/styles/global.css'
import '../src/styles/admin.css'
import '../src/styles/admin-medialist.css'

function Fixture() {
  const { setLang } = useLang()
  const longIdentity = new URLSearchParams(location.search).has('longIdentity')
  return <>
    <button onClick={() => setLang('ta')}>Test Tamil</button>
    <button onClick={() => setLang('en')}>Test English</button>
    <div style={{ height: 'calc(100vh - 30px)' }}>
      <SchemeWelfareCard card={{ voter_name: longIdentity ? 'TEST MEMBER WITH A LONG MULTI LINE FULL NAME' : 'TEST MEMBER', bjp_code: 'NT-TEST123', referral_link: 'https://tnbjp.org/?ref=NT-TEST123' }}
        voter={{ district: 'THIRUVALLUR', assembly_name: longIdentity ? 'TEST ASSEMBLY WITH A LONG LOCATION NAME' : 'Gummidipoondi' }}
        onBack={() => {}} onApplySchemes={() => { window.viewedMySchemes = true }} />
    </div>
  </>
}
createRoot(document.getElementById('root')).render(<LanguageProvider><Fixture /></LanguageProvider>)
