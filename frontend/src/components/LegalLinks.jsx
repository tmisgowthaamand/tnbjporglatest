import React from 'react';

// Links to the static legal pages (frontend/public/terms|privacy|contact).
// Plain <a> tags (not router links): those pages are served by nginx as static
// HTML so crawlers can read them. They open in a new tab so a member's
// in-progress chat is not lost.
const LINKS = [
  { href: '/terms/', label: 'Terms & Conditions' },
  { href: '/privacy/', label: 'Privacy Policy' },
  { href: '/contact/', label: 'Contact Us' },
];

const LegalLinks = ({ className = '' }) => (
  <div className={`legal-links ${className}`.trim()}>
    <nav className="legal-links-nav" aria-label="Legal">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
      ))}
    </nav>
    <p className="legal-links-copy">&copy; {new Date().getFullYear()} Central Government Schemes. All rights reserved.</p>
  </div>
);

export default LegalLinks;
