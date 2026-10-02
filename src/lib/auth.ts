import {supabase} from './supabase';
export async function signUp(email:string,password:string,fullName:string){if(!supabase)throw new Error('Supabase não configurado.');return supabase.auth.signUp({email,password,options:{data:{full_name:fullName}}});}
export async function signIn(email:string,password:string){if(!supabase)throw new Error('Supabase não configurado.');return supabase.auth.signInWithPassword({email,password});}
export async function signOut(){if(!supabase)throw new Error('Supabase não configurado.');return supabase.auth.signOut();}
export async function currentUser(){if(!supabase)return null;const {data}=await supabase.auth.getUser();return data.user;}
