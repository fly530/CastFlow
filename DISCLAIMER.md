# Legal Disclaimer

**English** | [繁體中文](DISCLAIMER.zh-TW.md)

Before accessing, downloading, deploying, or distributing the **CastFlow** project (including its source code, container images, configuration manifests, and derivative works), please read this disclaimer carefully. By using this project, you acknowledge that you have read, understood, and unconditionally agreed to all terms stated below:

---

## 1. Audio Content & Copyright Compliance

1. **Software Framework Only**: CastFlow is an open-source automation, stream scheduling, and broadcast audio framework. The source repository, container images, and release artifacts **do not contain, distribute, host, or preload any copyrighted music, audio tracks, or broadcast media**.
2. **User Sole Responsibility**:
   * The station operator and individual user are solely and completely responsible for the legality and copyright compliance of any audio content uploaded, queued, scheduled, broadcast, or streamed via CastFlow.
   * Users are legally obligated to obtain all required licenses, public performance rights, and broadcast permissions from applicable copyright owners, collective management organizations, and licensing bodies (such as ASCAP, BMI, SESAC, PRS, GEMA, SACEM, JASRAC, MÜST, etc.) prior to any public transmission or online broadcasting.
3. **No Liability for Infringement**: The authors, core maintainers, and contributors of CastFlow **expressly disclaim all liability** for any copyright infringement, unauthorized transmission, intellectual property violation, civil lawsuit, or regulatory penalty resulting from the use of this software by third parties.

---

## 2. "AS IS" Provision & No Warranty

In accordance with the [MIT License](LICENSE):

* **No Warranties Express or Implied**: The software is provided "AS IS", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.
* **No Guarantee of Uninterrupted Operation**: The maintainers do not warrant that the operation of the software will be uninterrupted, error-free, low-latency, or completely fail-safe, nor that audio processing, crossfading, stream transcoding, or HLS segment distribution will meet high-availability industrial broadcast standards.
* **Limitation of Liability & Data Loss**: Users assume all risks associated with using the software. In no event shall the authors or contributors be liable for any direct, indirect, incidental, consequential, special, or exemplary damages—including but not limited to loss of profits, station downtime, corrupted database files, audio file loss, or hardware failure.

---

## 3. Network Security & Self-Hosting Responsibilities

* **Credential Management**: CastFlow incorporates random password generation and JWT signature verification. System administrators are solely responsible for securing private keys, changing default credentials, and preventing unauthorized exposure of sensitive ports (such as unauthenticated Telnet sockets, default Icecast passwords, or raw database volumes) to the public internet.
* **Production Hardening**: When deploying in publicly accessible environments, users are strongly advised to place services behind a secure reverse proxy (e.g., Nginx, Caddy, or Traefik) with valid SSL/TLS certificates, proper firewall configurations, and access rate limiting.

---

## 4. Third-Party Open Source Software Disclosures

This project incorporates and interacts with multiple third-party open-source components (including Liquidsoap, Icecast, Nginx, React, Node.js, and related libraries). Each component is licensed under the terms established by its respective copyright holders (e.g., GPL, Apache-2.0, MIT, BSD, ISC).
CastFlow adheres to container isolation boundaries to ensure clean architectural separation. For full details on third-party licenses and credits, please review [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).

---

## 5. Trademarks Notice

All third-party trademarks, service marks, trade names, product names, and logos cited within this project, documentation, or code (including but not limited to Liquidsoap, Icecast, Kubernetes, K3s, Docker, ESP32, React, TailwindCSS, and Node.js) are the property of their respective owners. Any reference is made solely for descriptive, technical, and compatibility purposes, and does not imply endorsement, sponsorship, or affiliation.
