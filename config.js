// Configuração do Supabase — Painel Administrativo Central
// Mesmo projeto Supabase do Torque (mesma URL pública e mesma anon key já
// usadas em qa/../config.js do site principal) - o painel administrativo
// não é um projeto Supabase separado, só um frontend separado que fala com
// o mesmo backend, sempre através de RPCs restritas a administrador ativo.
// A chave anon é própria para uso no frontend quando o banco está protegido
// por RLS. Nunca coloque aqui service_role ou qualquer outro segredo privado.
const SUPABASE_URL = 'https://icfoexzfnrdhvdripqfo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZm9leHpmbnJkaHZkcmlwcWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODc1ODMsImV4cCI6MjEwMjA2MzU4M30.S2ID3zc3tCwUO03xRCLAEp8u8Bo6CRLW45sWLbMlkhg';
