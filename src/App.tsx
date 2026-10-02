import {useMemo,useState} from 'react';
import{Search,ShoppingBag,UserRound,Headphones,ShieldCheck,Zap,X,Plus,Minus,ChevronRight}from'lucide-react';

type Product={id:number;name:string;category:string;price:number;old?:number;icon:string;tag?:string;stock?:boolean};
const products:Product[]=[
{id:1,name:'Assinatura Premium',category:'Assinaturas',price:6.90,icon:'✦',tag:'ENTREGA DIGITAL'},
{id:2,name:'IA Criativa Pro',category:'Assinaturas',price:11.00,icon:'✧',tag:'ENTREGA DIGITAL'},
{id:3,name:'Editor Pro',category:'Assinaturas',price:3.10,icon:'✂',tag:'ENTREGA DIGITAL'},
{id:4,name:'Streaming Digital',category:'Assinaturas',price:3.90,icon:'▶',tag:'ENTREGA DIGITAL'},
{id:5,name:'Game Key Premium',category:'Games',price:12.90,icon:'🎮',tag:'KEY DIGITAL'},
{id:6,name:'Game Key Deluxe',category:'Games',price:21.90,icon:'⚔',tag:'KEY DIGITAL',stock:false},
{id:7,name:'Discord Nitro',category:'Discord',price:9.90,icon:'◉',tag:'ENTREGA DIGITAL'},
{id:8,name:'Pacote Discord',category:'Discord',price:5.90,icon:'◆',tag:'ENTREGA DIGITAL'}];
const sections=['Assinaturas','Games','Discord'];
const money=(v:number)=>'R$ '+v.toFixed(2).replace('.',',');

export default function App(){
 const[cart,setCart]=useState<Record<number,number>>({});const[open,setOpen]=useState(false);
 const count=Object.values(cart).reduce((a,b)=>a+b,0);
 const total=useMemo(()=>products.reduce((s,p)=>s+(cart[p.id]||0)*p.price,0),[cart]);
 const add=(p:Product)=>{if(p.stock===false)return;setCart(c=>({...c,[p.id]:(c[p.id]||0)+1}))};
 const change=(id:number,d:number)=>setCart(c=>{const n=Math.max(0,(c[id]||0)+d),x={...c};if(n)x[id]=n;else delete x[id];return x});
 return <div className="site">
  <header>
   <a className="brand" href="#"><span className="crest">N</span><span><b>NEXIUM</b><small>STORE</small></span></a>
   <nav><a href="#">Início</a><a href="#loja">Loja</a><a href="#loja">Categorias</a><a href="#suporte">Suporte</a></nav>
   <div className="actions"><button aria-label="Pesquisar"><Search/></button><button aria-label="Suporte"><Headphones/></button><button className="bag" onClick={()=>setOpen(true)} aria-label="Carrinho"><ShoppingBag/><b>{count}</b></button><button className="login"><UserRound/><span>Entrar</span></button></div>
  </header>
  <main>
   <section className="hero">
    <div className="heroMark">N</div><div className="eyebrow">✦ NEXIUM DIGITAL</div>
    <h1>Seu universo digital<br/><em>em um só lugar.</em></h1>
    <p>Produtos digitais, licenças e serviços autorizados com uma experiência rápida, segura e premium.</p>
    <a href="#loja" className="primary">Explorar produtos <ChevronRight/></a>
    <div className="trust"><span><ShieldCheck/> Compra segura</span><span><Zap/> Entrega rápida</span><span><Headphones/> Suporte ativo</span></div>
   </section>
   <section id="loja" className="catalog">
    {sections.map(section=><div className="productSection" key={section}>
      <div className="sectionTitle"><div><small>CATÁLOGO NEXIUM</small><h2>{section}</h2></div><a href="#loja">Ver todos <ChevronRight/></a></div>
      <div className="grid">{products.filter(p=>p.category===section).map(p=><article className={'card '+(p.stock===false?'sold':'')} key={p.id}>
       <div className="visual"><div className="mesh"></div><span className="productIcon">{p.icon}</span><div className="watermark">NEXIUM</div><i>{p.tag}</i>{p.stock===false&&<strong className="soldBadge">ESGOTADO</strong>}</div>
       <div className="cardBody"><h3>{p.name}</h3><div className="price"><strong>{money(p.price)} <span>+</span></strong><small>À vista no PIX</small></div><button disabled={p.stock===false} onClick={()=>add(p)}>{p.stock===false?'Ver detalhes':'Comprar'}<ShoppingBag/></button></div>
      </article>)}</div>
    </div>)}
   </section>
   <section id="suporte" className="benefits"><div><ShieldCheck/><b>COMPRA SEGURA</b><span>Ambiente protegido</span></div><div><Zap/><b>ENTREGA DIGITAL</b><span>Rápida e prática</span></div><div><Headphones/><b>SUPORTE ATIVO</b><span>Quando precisar</span></div></section>
  </main>
  <footer><div className="brand"><span className="crest">N</span><span><b>NEXIUM</b><small>STORE</small></span></div><p>Seu universo digital em um só lugar.</p><small>© 2026 Nexium Store • Termos • Privacidade • Reembolso</small></footer>
  {open&&<><div className="overlay" onClick={()=>setOpen(false)}/><aside className="cart"><div className="cartHead"><h2>Carrinho <span>{count}</span></h2><button onClick={()=>setOpen(false)}><X/></button></div>{count===0?<div className="empty"><ShoppingBag/><h3>Seu carrinho está vazio</h3><p>Escolha um produto para continuar.</p></div>:<div className="cartItems">{products.filter(p=>cart[p.id]).map(p=><div className="cartItem" key={p.id}><div className="mini">{p.icon}</div><div><strong>{p.name}</strong><span>{money(p.price)}</span><div className="qty"><button onClick={()=>change(p.id,-1)}><Minus/></button><b>{cart[p.id]}</b><button onClick={()=>change(p.id,1)}><Plus/></button></div></div></div>)}<div className="total"><span>Total</span><strong>{money(total)}</strong></div><button className="checkout">Continuar compra</button></div>}</aside></>}
 </div>
}