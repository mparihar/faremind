import Link from 'next/link';
import { Plane, ExternalLink, MessageCircle, Mail, Sparkles, Shield, Zap, Globe } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="relative mt-auto bg-[#1a1a2e] text-white/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center group mb-4">
              <img 
                src="/logo.png" 
                alt="FareMind" 
                className="h-[80px] w-auto object-contain mix-blend-screen"
              />
            </Link>
            <p className="text-sm text-slate-600 leading-relaxed mb-6 font-medium">
              AI-powered flight booking that monitors prices and automatically
              finds you the best deals. Search smarter, save more.
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
            <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-wider">Product</h3>
            <ul className="space-y-3">
              {[
                'Flight Search',
                'Price Tracking',
                'Smart Rebooking',
                'Booking Dashboard',
                'API Access',
              ].map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-slate-400 hover:text-white transition-colors">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-wider">Company</h3>
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
            <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-wider">Why FareMind</h3>
            <ul className="space-y-4">
              {[
                { icon: Sparkles, text: 'AI price intelligence' },
                { icon: Shield, text: 'Secure & private' },
                { icon: Zap, text: 'Real-time updates' },
                { icon: Globe, text: 'Multi-source aggregation' },
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
        <div className="mt-12 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} FareMind. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((item) => (
              <a key={item} href="#" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
