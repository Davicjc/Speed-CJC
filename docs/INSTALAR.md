# Instalação do zero, numa VM crua

Este guia leva uma máquina virtual recém-criada (só o sistema operacional) até o
teste de velocidade funcionando, primeiro na rede local e depois publicado com
HTTPS num domínio. Não precisa de nenhum serviço externo: contas, testes e
administração ficam na própria VM.

> **Resumo para quem tem pressa:** numa VM Debian 12 ou Ubuntu 24.04, como root:
>
> ```bash
> apt-get update && apt-get install -y curl     # o Debian mínimo não vem com curl
> curl -fsSL https://raw.githubusercontent.com/Davicjc/Speed-CJC/main/server/tools/instalar.sh | bash
> ```
>
> Abra `http://IP-DA-VM:8080`. Pronto. O resto deste guia explica cada passo,
> como publicar no domínio e como fazer tudo à mão.

---

## Sumário

1. [O que você precisa](#1-o-que-você-precisa)
2. [Instalar na rede local (um comando)](#2-instalar-na-rede-local-um-comando)
3. [Criar o administrador principal](#3-criar-o-administrador-principal)
4. [Publicar na internet com HTTPS](#4-publicar-na-internet-com-https)
5. [Passo a passo manual (sem o instalador)](#5-passo-a-passo-manual-sem-o-instalador)
6. [Conferir se está tudo certo](#6-conferir-se-está-tudo-certo)
7. [Atualizar para uma versão nova](#7-atualizar-para-uma-versão-nova)
8. [Desinstalar](#8-desinstalar)
9. [Problemas na instalação](#9-problemas-na-instalação)

---

## 1. O que você precisa

**A VM**

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Debian 12 ou Ubuntu 22.04 / 24.04, 64 bits (x86_64 ou ARM64) | Debian 12 |
| Processador | 2 vCPU | 4 vCPU |
| Memória | 1 GB | 2 GB |
| Disco | 5 GB | 20 GB (banco e cópias de segurança crescem com o uso) |
| Placa de rede | 1 Gbps | 10 Gbps |

A placa de rede é o que mais importa: **o teste mede até o limite da VM**. Numa
VM com placa de 1 Gbps, ninguém mede mais que ~940 Mbps. Para medir planos de
1 Gbps com folga, use 10 Gbps (no VMware, placa `vmxnet3`).

**Acesso**

- SSH com usuário `root` ou com `sudo`.
- A VM precisa sair para a internet (para baixar pacotes, a hora oficial e o
  mapa).

**Para publicar na internet** (seção 4; para a rede local não precisa):

- um domínio ou subdomínio seu (ex.: `velocidade.seuprovedor.com.br`);
- um IPv4 público que chegue até a VM (direto ou encaminhado pelo roteador).

---

## 2. Instalar na rede local (um comando)

Entre na VM por SSH e vire root:

```bash
ssh usuario@IP-DA-VM
sudo -i
```

O Debian 12 mínimo não vem com `curl` (nem `wget`). Instale antes:

```bash
apt-get update && apt-get install -y curl
```

Rode o instalador:

```bash
curl -fsSL https://raw.githubusercontent.com/Davicjc/Speed-CJC/main/server/tools/instalar.sh | bash
```

> Prefere ler antes de rodar? Baixe, leia e só depois execute:
> ```bash
> curl -fsSLO https://raw.githubusercontent.com/Davicjc/Speed-CJC/main/server/tools/instalar.sh
> less instalar.sh
> bash instalar.sh
> ```

O que ele faz, na ordem:

1. instala `git`, `curl`, `iproute2`, `iputils-ping` (MTU e duplo NAT),
   `mtr-tiny` (rota até o cliente) e `tcpdump` (diagnóstico de NAT);
2. instala o **Node.js 22** pelo repositório oficial da NodeSource, se a VM não
   tiver um Node 22.13 ou mais novo;
3. baixa o projeto em `/opt/speed-cjc` (`git clone`);
4. instala as dependências do servidor (`npm ci`);
5. cria o serviço `speed-cjc` no systemd, que sobe sozinho com a VM;
6. se o firewall `ufw` estiver ligado, libera TCP e UDP 8080.

No fim ele mostra o endereço. Abra no navegador:

```
http://IP-DA-VM:8080
```

O teste já funciona. Num Debian 12 mínimo, recém-instalado, a instalação levou
cerca de 1 minuto. Depende da velocidade da VM e da rede.

Opções úteis do instalador:

| Opção | O que faz |
|---|---|
| `--pasta /srv/speedtest` | instala em outra pasta (padrão `/opt/speed-cjc`) |
| `--dono voce@email --dono-nome "Seu Nome"` | já cria o administrador principal (seção 3) |
| `--dominio ...` | já publica com HTTPS (seção 4) |
| `--so-preparar` | só instala dependências e o projeto, sem ligar nada |
| `--repo URL` | usa outro repositório (um fork seu, por exemplo) |

Para passar opções pelo comando de uma linha, use `bash -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/Davicjc/Speed-CJC/main/server/tools/instalar.sh \
  | bash -s -- --dono voce@email.com --dono-nome "Seu Nome"
```

---

## 3. Criar o administrador principal

O site já aceita cadastros, mas a **Administração** (`/admin`) só abre para
administradores. O primeiro, chamado **dono**, é criado pelo terminal da VM, de
propósito: ninguém consegue virar dono pela internet.

```bash
cd /opt/speed-cjc/server
npm run admin -- dono voce@email.com "Seu Nome"
```

Ele mostra um **link para escolher a senha** (vale 24 horas, funciona uma vez).
Abra o link, escolha a senha e entre: o menu ganha **Administração**. De lá você
dá acesso de administrador a outras pessoas.

Esqueceu a senha do dono e o e-mail não está configurado?

```bash
npm run admin -- link voce@email.com
```

---

## 4. Publicar na internet com HTTPS

Para o público, o site precisa de **HTTPS**: sem ele o navegador marca "não
seguro", bloqueia a localização do aparelho, e as senhas trafegariam abertas. O
`publicar.sh` cuida disso com o [Caddy](https://caddyserver.com), que tira e
renova o certificado gratuito do Let's Encrypt sozinho.

### 4.1 Antes: DNS e portas

**No roteador ou firewall da borda**, encaminhe para o IP interno da VM:

| Porta | Para quê |
|---|---|
| TCP 80 | emissão do certificado e redirecionamento para HTTPS |
| TCP 443 | o site |
| UDP 8080 | teste de perda de pacotes (vai direto ao Node, sem o Caddy) |

**No DNS do seu domínio:**

| Nome | Tipo | Valor | Obrigatório? |
|---|---|---|---|
| `velocidade` | A | o IPv4 público | sim |
| `v4.velocidade` | A | o mesmo IPv4 (sem AAAA) | recomendado: diagnóstico IPv4 × IPv6 |
| `velocidade` | AAAA | o IPv6 da VM | só se ela tiver IPv6 público **liberado na borda** |
| `v6.velocidade` | AAAA | o IPv6 da VM (sem A) | idem |

Sem IPv6 público, não crie os AAAA e use `--sem-ipv6` no passo seguinte.

> Só crie um AAAA se o IPv6 da VM recebe conexões de fora de verdade. Se o
> firewall da borda bloquear, quem acessa por IPv6 vai esperar a conexão falhar
> até o navegador tentar o IPv4.

### 4.2 Publicar

```bash
bash /opt/speed-cjc/server/tools/publicar.sh \
     --dominio velocidade.seuprovedor.com.br \
     --dono voce@email.com --dono-nome "Seu Nome"
```

Rode antes com `--simular` para ver tudo o que ele faria sem mudar nada.

O que ele faz:

1. confere o DNS e mostra o que falta;
2. escreve o `server/.env` (endereço público, proxy, portas);
3. liga a sincronização de hora (NTP);
4. instala e configura o Caddy (HTTPS);
5. libera TCP 80, TCP 443 e UDP 8080 no `ufw`;
6. reinicia o serviço;
7. cria o dono, se você passou `--dono`;
8. confere se o domínio já chega nesta VM, pelo IPv4 e pelo IPv6.

O certificado é **sob demanda**: o Caddy só o pede na primeira visita pelo
domínio. Então pode rodar o `publicar.sh` antes de o DNS estar pronto: quando o
DNS passar a apontar para a VM, o primeiro acesso já sai com o cadeado.

Com o site no ar pelo domínio, feche a porta antiga para o acesso ser só por
HTTPS:

```bash
bash /opt/speed-cjc/server/tools/publicar.sh --dominio velocidade.seuprovedor.com.br --fechar-8080
```

Outras opções do `publicar.sh`:

| Opção | O que faz |
|---|---|
| `--ip 203.0.113.10` | fixa o IPv4 público anunciado no teste de perda (sem ela, vale o do DNS) |
| `--sem-ipv6` | sem IPv6 público: não usa o nome `v6.` |
| `--turnstile-site` / `--turnstile-secret` | liga o captcha da Cloudflare (ver [MANUAL.md](MANUAL.md#8-captcha-do-cadastro)) |

Para o e-mail (confirmação de cadastro e "esqueci minha senha"), veja a seção 7
do [MANUAL.md](MANUAL.md#7-e-mail-opcional). É opcional.

---

## 5. Passo a passo manual (sem o instalador)

O mesmo que o instalador faz, comando por comando, para quem quer entender ou
adaptar.

### 5.1 Pacotes

```bash
apt-get update
apt-get install -y ca-certificates curl git gnupg iproute2 iputils-ping mtr-tiny tcpdump
```

### 5.2 Node.js 22 (repositório oficial da NodeSource)

```bash
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node -v      # v22.13 ou mais novo
```

O Node 22.13 é o mínimo porque o banco de dados usa o SQLite que vem dentro do
Node (`node:sqlite`). Não é preciso instalar banco nenhum.

### 5.3 O projeto

```bash
git clone https://github.com/Davicjc/Speed-CJC.git /opt/speed-cjc
cd /opt/speed-cjc/server
npm ci --omit=dev
```

### 5.4 Configuração

Para a rede local, não precisa de configuração: os padrões funcionam. Para mudar
algo, copie o modelo comentado:

```bash
cp .env.example .env
nano .env
```

Tudo o que dá para configurar está na seção 6 do [MANUAL.md](MANUAL.md#6-configuração-do-servidor-env).

### 5.5 Rodar

Para testar na hora, em primeiro plano (Ctrl+C para parar):

```bash
npm start
```

Como serviço, que sobe sozinho com a VM:

```bash
bash tools/servico.sh
```

O `servico.sh` preenche o modelo `deploy/speed-cjc.service` com a pasta
e o Node desta máquina, instala no systemd e confere se o site respondeu.

### 5.6 Firewall

```bash
ufw allow 8080/tcp
ufw allow 8080/udp
```

Daqui em diante, siga a seção 3 (administrador) e, para o público, a seção 4.

---

## 6. Conferir se está tudo certo

```bash
systemctl status speed-cjc          # "active (running)"
curl -s http://127.0.0.1:8080/api/health    # "ok":true
cd /opt/speed-cjc/server && npm test # testes automáticos (não tocam no banco real)
```

No navegador:

- [ ] a página inicial abre e o teste roda até o fim;
- [ ] "Criar conta" funciona (com o captcha) e o teste vai para o painel;
- [ ] o dono entra em `/admin` e vê o teste, a pessoa online e o mapa;
- [ ] com HTTPS: o cadeado aparece e a opção "Registrar a localização" fica
      liberada.

A lista completa está na seção 18 do [MANUAL.md](MANUAL.md#18-conferência-final).

---

## 7. Atualizar para uma versão nova

O jeito mais simples é rodar o instalador de novo: ele faz `git pull`,
reinstala as dependências e reinicia o serviço, sem mexer no banco nem no `.env`.

```bash
bash /opt/speed-cjc/server/tools/instalar.sh
```

À mão:

```bash
cd /opt/speed-cjc
git pull
cd server && npm ci --omit=dev
systemctl restart speed-cjc
```

O banco de dados se atualiza sozinho ao subir, quando a versão nova precisar.
Antes de uma atualização grande, guarde uma cópia de `server/data/` (veja a seção
12 do [MANUAL.md](MANUAL.md#12-banco-de-dados-e-cópias-de-segurança)).

---

## 8. Desinstalar

```bash
systemctl disable --now speed-cjc
rm /etc/systemd/system/speed-cjc.service
systemctl daemon-reload
# guarde server/data/ se quiser manter contas e testes:
cp -a /opt/speed-cjc/server/data ~/speed-cjc-dados
rm -rf /opt/speed-cjc
# se usou o publicar.sh:
apt-get remove caddy
```

---

## 9. Problemas na instalação

| O que aparece | Causa provável | Como resolver |
|---|---|---|
| `Rode como root (sudo)` | usuário comum | `sudo -i` antes, ou `curl ... \| sudo bash` |
| `Este instalador é para Debian/Ubuntu` | outra distribuição | use o passo a passo manual (seção 5) com o gerenciador de pacotes dela |
| `npm ci` falha em `node-datachannel` | a VM não consegue baixar o binário pronto do GitHub, ou a arquitetura não é x86_64/ARM64 | confira a saída para a internet; em outra arquitetura, instale `cmake` e `g++` e rode `npm ci` de novo |
| `node: command not found` depois de instalar | o terminal ainda não enxerga o Node novo | abra outro terminal ou rode `hash -r` |
| O site não abre de outro computador | firewall | `ufw allow 8080/tcp` e `ufw allow 8080/udp`; confira também o firewall do hipervisor |
| Perda de pacotes: "UDP bloqueado" | UDP 8080 fechado no caminho | libere UDP 8080 até a VM; atrás de NAT, encaminhe também |
| `systemctl` não existe | container sem systemd | rode com `npm start`, ou use uma VM de verdade |
| O serviço não sobe | erro no `.env` ou porta ocupada | `journalctl -u speed-cjc -n 50` |

Problemas depois de instalado (e-mail, certificado, login, mapa): seção 17 do
[MANUAL.md](MANUAL.md#17-solução-de-problemas).
