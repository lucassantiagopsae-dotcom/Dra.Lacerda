# Dra. Victoria Lacerda — Landing Page (Slim Balance)

Landing page de captação para o método **Slim Balance** — emagrecimento com avaliação médica
(nutrologia), São José do Rio Preto/SP. CTA principal: WhatsApp.

## Estrutura

```
.
├── index.html                        # A landing page (a construir)
├── assets/                           # Imagens, logo, favicon
├── docs/
│   └── referencia/
│       ├── copy-landing-page.md      # Copy completa, dobra a dobra (fonte da verdade)
│       ├── Dra Victoria - Landing Page.pdf   # Briefing original da cliente
│       └── imagens-pdf/              # Prints extraídos do PDF (depoimentos Google)
└── README.md
```

## Identidade visual

Paleta amostrada diretamente dos posts do Instagram dela (que vieram no PDF do briefing):

| Token | Hex | Uso |
|-------|-----|-----|
| Bordô | `#611D17` | Fundo do hero, seções escuras, CTA sobre creme |
| Bordô profundo | `#4A1611` | Seção "Sobre a Dra.", hover de botão |
| Bordô tinta | `#330F0B` | Tarja do hero, rodapé |
| Creme | `#EFE9DE` | Fundo geral, texto sobre bordô |
| Creme 2 | `#DBD5C8` | Seção de depoimentos, texto secundário |
| Creme 3 | `#C9C1B1` | Filetes, labels |
| Tinta | `#221F1C` | Texto sobre creme |

**Tipografia:** Bodoni Moda (display, com itálico como ênfase — o briefing pede) +
Archivo (corpo e interface). Ambas via Google Fonts.

**Elemento-assinatura:** as *tarjas de recorte* do hero — cada linha do título assenta
sobre uma barra sólida, com `box-decoration-break: clone` para que a quebra de linha gere
uma tarja nova. É o mesmo mecanismo das artes do Instagram dela. A animação de entrada
faz as tarjas "assentarem" da esquerda para a direita, como fita. Respeita
`prefers-reduced-motion`.

**Granulado:** ruído SVG em overlay nas seções bordô, também presente nos posts.

## Rodar localmente

```bash
python -m http.server 8412
```

Ou via preview do Claude Code: configuração `lacerda-lp` em `.claude/launch.json` (raiz do RUGIDO).

## Contatos e links

| Item | Destino |
|------|---------|
| WhatsApp (CTA) | (17) 99745-4974 |
| Instagram | https://www.instagram.com/dravictorialacerda/ |
| Endereço | Georgina Business Park - Setor Ásia - Av. Anísio Haddad, 8001 - Sala 106 Bangkok - Jardim Aclimação, São José do Rio Preto - SP |
| Maps | https://maps.app.goo.gl/tft7rNs8DHDH3DsAA |
| Registro | Dra. Victoria Lacerda — CRM-SP 196.390 |

## Pendências

- [ ] Paleta exata (bordô/creme) e tipografia
- [ ] Foto definitiva da Dra. (a original é com terno verde — avaliar contraste com o bordô)
- [ ] Validar transcrição dos depoimentos com a cliente
- [ ] Hospedagem e domínio
