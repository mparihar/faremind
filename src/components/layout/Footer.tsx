'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plane, ExternalLink, MessageCircle, Mail, Sparkles, Shield, Zap, Globe, Brain, Dna, ListOrdered, LineChart } from 'lucide-react';
import FeatureExplanationModal from './FeatureExplanationModal';

export default function Footer() {
  const [modalState, setModalState] = useState<'none' | 'ranking' | 'intelligence'>('none');

  const openModal = (type: 'ranking' | 'intelligence') => {
    setModalState(type);
  };

  const closeModal = () => {
    setModalState('none');
  };

  return (
    <footer className="relative mt-auto bg-[#1a1a2e] text-white/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="mb-6 flex flex-col w-fit">
              <Link href="/" className="flex items-center group">
                <div className="flex items-end">
                  <img
                    src="/FM_IMG_LOGO_TEAL.png"
                    alt=""
                    className="max-h-[54px] w-auto object-contain mb-[-8px] mix-blend-screen"
                  />
                  <div className="flex flex-col items-center -ml-2">
                    <img
                      src="/FM_TXT_LOGO.png"
                      alt="FareMind"
                      className="h-[42px] w-auto object-contain mix-blend-screen"
                    />
                    <div className="flex flex-col items-center w-full -mt-[8px]">
                      <div className="relative w-full h-[1px] mb-[1px]">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent"></div>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent blur-[1px]"></div>
                      </div>
                      <span className="text-[7px] sm:text-[8px] font-medium uppercase tracking-[0.7em] text-white/90 pl-[0.7em]">
                        FREE YOUR <span className="text-[#009CA6] font-bold">MIND</span>
                      </span>
                      <div className="relative w-full h-[1px] mt-[1px]">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent"></div>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent blur-[1px]"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6 font-medium">
              AI-powered flight search, ranking, and personalization built around how <span className="text-[#009CA6]">you</span> travel.
            </p>
            <div className="flex items-center gap-3">
              {[
                { icon: MessageCircle, href: '#' },
                { icon: ExternalLink, href: '#' },
                { icon: Mail, href: '#' },
              ].map((social, i) => (
                <a
                  key={i}
                  href={social.href}
                  className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] hover:border-white/[0.15] transition-all"
                >
                  <social.icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Product</h3>
            <ul className="space-y-3">
              {[
                { name: 'Flight Search', type: 'link', href: '/search' },
                { name: 'AI Flight Ranking', type: 'modal', modalType: 'ranking' },
                { name: 'Price Intelligence', type: 'modal', modalType: 'intelligence' },
                { name: 'My FareMind DNA™', type: 'link', href: '/travel-dna' },
                { name: 'Voice Assistant', type: 'action' },
              ].map((item) => (
                <li key={item.name}>
                  {item.type === 'link' ? (
                    <Link href={item.href!} className="text-sm text-slate-400 hover:text-white transition-colors">
                      {item.name === 'My FareMind DNA™' ? (
                        <>My <span className="text-white">FARE</span><span className="text-[#009CA6]">MIND</span> DNA™</>
                      ) : (
                        item.name
                      )}
                    </Link>
                  ) : item.type === 'modal' ? (
                    <button
                      onClick={() => openModal(item.modalType as 'ranking' | 'intelligence')}
                      className="text-sm text-slate-400 hover:text-white transition-colors text-left"
                    >
                      {item.name}
                    </button>
                  ) : (
                    <button
                      className="text-sm text-slate-400 hover:text-white transition-colors text-left"
                    >
                      {item.name}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-sm font-black text-white mb-4 uppercase tracking-wider">Company</h3>
            <ul className="space-y-3">
              {['About', 'Careers', 'Blog', 'Press', 'Contact'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-slate-400 hover:text-white transition-colors">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Features */}
          <div>
            <h3 className="text-sm font-black text-white mb-4 uppercase tracking-wider">
              Why FARE<span className="text-[#009CA6]">MIND</span>
            </h3>
            <ul className="space-y-4">
              {[
                { icon: Brain, text: 'AI-Powered Recommendations' },
                { icon: Dna, text: 'Personalized Travel DNA' },
                { icon: Shield, text: 'Secure & Private' },
                { icon: Globe, text: 'More Flight Choices' },
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-sun-gold/10 flex items-center justify-center">
                    <item.icon className="w-4 h-4 text-sun-gold" />
                  </div>
                  <span className="text-sm text-slate-600 font-medium">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-white/[0.06] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} FAREMIND.AI. All rights reserved.
            </p>
            <p className="text-xs text-slate-500/80 leading-relaxed">
              FAREMIND.AI is a travel technology brand operated by Chatore LLC, a Texas limited liability company.
            </p>
          </div>
          <div className="flex items-center gap-6 mt-6">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((item) => (
              <a key={item} href="#" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>

      <FeatureExplanationModal
        isOpen={modalState === 'ranking'}
        title="AI Flight Ranking"
        icon={ListOrdered}
        description="FareMind automatically evaluates flight options after every search and ranks them based on overall travel value."
        bulletPoints={[
          "Compares price, duration, stops, comfort, and flexibility",
          "Highlights options with the best overall balance",
          "Works automatically after every flight search",
          "Can use My FareMind DNA™ when the user is logged in and personalization is active"
        ]}
        footerNote="AI Flight Ranking is applied after search results are returned. It is not a separate booking page."
        onClose={closeModal}
      />

      <FeatureExplanationModal
        isOpen={modalState === 'intelligence'}
        title="Price Intelligence"
        icon={LineChart}
        description="FareMind helps users understand fare movement and eligible price opportunities without requiring them to manually monitor routes."
        bulletPoints={[
          "Tracks eligible bookings and watched routes",
          "Detects meaningful price changes when available",
          "Supports price protection workflows where applicable",
          "Helps travelers make smarter booking decisions"
        ]}
        footerNote="FareMind does not scan every flight globally. Price Intelligence applies to eligible bookings, watched routes, or supported protection products."
        onClose={closeModal}
      />
    </footer>
  );
}
