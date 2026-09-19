"use strict";

/* ==========================================================
   INEM · Gestor de Contratos
   ========================================================== */

(() => {
  const CHAVE_STORAGE = "inem_contratos_v1";
  const CHAVE_CONTADOR = "inem_contador_v1";
  const ESTADOS = ["Ativo", "Suspenso", "Rescindido"];
  const LIMITES = { nome: 80, contacto: 30, numero: 30, cargo: 60, obs: 1000 };

  const $ = (seletor) => document.querySelector(seletor);

  const form = $("#contract-form");
  const campos = {
    nome: $("#nome"),
    contacto: $("#contacto"),
    numero: $("#numero"),
    cargo: $("#cargo"),
    estado: $("#estado"),
    admissao: $("#admissao"),
    validade: $("#validade"),
    obs: $("#obs"),
  };
  const folhaEl = $("#document-view");
  const listaEl = $("#record-list");
  const pesquisaEl = $("#search");
  const contadorEl = $("#db-count");
  const toastEl = $("#toast");
  const ficheiroEl = $("#file-import");
  const TITULO_BASE = document.title;

  let contratos = carregar();
  let idAtual = null; // id do contrato que está aberto no formulário (null = novo)

  /* ---------- Utilitários ---------- */

  function el(tag, atributos = {}, texto) {
    const e = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos))
      e.setAttribute(chave, valor);
    if (texto != null) e.textContent = texto;
    return e;
  }

  function novoId() {
    if (window.crypto && typeof crypto.randomUUID === "function")
      return crypto.randomUUID();
    return (
      "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  function paraISO(data) {
    const m = String(data.getMonth() + 1).padStart(2, "0");
    const d = String(data.getDate()).padStart(2, "0");
    return `${data.getFullYear()}-${m}-${d}`;
  }

  function hojeISO() {
    return paraISO(new Date());
  }

  function formatarData(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
    const [ano, mes, dia] = iso.split("-");
    return `${dia}/${mes}/${ano}`;
  }

  function adicionarDias(iso, dias) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    return paraISO(new Date(ano, mes - 1, dia + dias));
  }

  function normalizar(texto) {
    return String(texto)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  const prefereMenosMovimento = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let temporizadorToast;
  function toast(mensagem, tipo = "ok") {
    toastEl.textContent = mensagem;
    toastEl.className = `toast is-visible is-${tipo}`;
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(
      () => toastEl.classList.remove("is-visible"),
      3800,
    );
  }

  function erro(mensagem, seletorFoco) {
    toast(mensagem, "erro");
    if (seletorFoco) $(seletorFoco).focus();
    return false;
  }

  function mascararContacto(valor) {
    // 1. Remove tudo o que não for dígito numérico
    const digitos = String(valor || "")
      .replace(/\D/g, "")
      .slice(0, 9);

    // 2. Monta o formato (111) 111-111 à medida que o utilizador escreve
    if (digitos.length === 0) return "";
    if (digitos.length <= 3) return `(${digitos}`;
    if (digitos.length <= 6)
      return `(${digitos.slice(0, 3)}) ${digitos.slice(3)}`;
    return `(${digitos.slice(0, 3)}) ${digitos.slice(3, 6)}-${digitos.slice(6)}`;
  }

  /* ---------- Persistência (localStorage) ---------- */

  function sanitizar(bruto) {
    if (!bruto || typeof bruto !== "object") return null;

    const texto = (valor, max) =>
      (valor == null ? "" : String(valor)).trim().slice(0, max);
    const data = (valor) =>
      /^\d{4}-\d{2}-\d{2}$/.test(String(valor || "")) ? String(valor) : "";

    const contrato = {
      id: texto(bruto.id, 64) || novoId(),
      nome: texto(bruto.nome, LIMITES.nome),
      contacto: texto(bruto.contacto, LIMITES.contacto),
      numero: texto(bruto.numero, LIMITES.numero),
      cargo: texto(bruto.cargo, LIMITES.cargo),
      estado: ESTADOS.includes(bruto.estado) ? bruto.estado : "Ativo",
      admissao: data(bruto.admissao),
      validade: data(bruto.validade),
      obs: texto(bruto.obs, LIMITES.obs),
      atualizadoEm: texto(bruto.atualizadoEm, 40) || new Date().toISOString(),
    };

    return contrato.nome && contrato.numero ? contrato : null;
  }

  function carregar() {
    try {
      const guardado = JSON.parse(localStorage.getItem(CHAVE_STORAGE) || "[]");
      return Array.isArray(guardado)
        ? guardado.map(sanitizar).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  function persistir() {
    try {
      localStorage.setItem(CHAVE_STORAGE, JSON.stringify(contratos));
      return true;
    } catch {
      toast(
        "Não foi possível guardar: o armazenamento do navegador está cheio ou bloqueado.",
        "erro",
      );
      return false;
    }
  }

  /* ---------- Formulário e pré-visualização ---------- */

  function lerForm() {
    return {
      nome: campos.nome.value.trim(),
      contacto: campos.contacto.value.trim(),
      numero: campos.numero.value.trim(),
      cargo: campos.cargo.value,
      estado: campos.estado.value,
      admissao: campos.admissao.value,
      validade: campos.validade.value,
      obs: campos.obs.value.trim(),
    };
  }

  function definirCargo(valor) {
    const select = campos.cargo;
    const existe = Array.from(select.options).some((o) => o.value === valor);
    if (valor && !existe) select.append(new Option(valor, valor));
    select.value = valor;
  }

  function preencherForm(c) {
    campos.nome.value = c.nome;
    campos.contacto.value = mascararContacto(c.contacto); // <--- Atualizado aqui
    campos.numero.value = c.numero;
    definirCargo(c.cargo);
    campos.estado.value = c.estado;
    campos.admissao.value = c.admissao;
    campos.validade.value = c.validade;
    campos.obs.value = c.obs;
  }

  function renderDocumento() {
    const dados = lerForm();
    const valores = {
      ...dados,
      admissao: formatarData(dados.admissao),
      validade: formatarData(dados.validade),
      estado_min: dados.estado.toLowerCase(),
      hoje: formatarData(hojeISO()),
    };

    folhaEl.querySelectorAll("[data-bind]").forEach((elemento) => {
      const valor = valores[elemento.dataset.bind] || "";
      const vazio = valor === "";
      elemento.textContent = vazio ? elemento.dataset.placeholder || "" : valor;
      elemento.classList.toggle(
        "is-empty",
        vazio && !elemento.hasAttribute("data-plain"),
      );
    });

    const etiquetaEstado = folhaEl.querySelector(".estado-tag");
    if (etiquetaEstado) etiquetaEstado.dataset.estado = dados.estado;

    atualizarTitulo();
  }

  /* ---------- Lista de contratos guardados ---------- */

  function criarItem(c) {
    const li = el("li", {
      class: "record" + (c.id === idAtual ? " is-active" : ""),
      "data-id": c.id,
    });

    const principal = el("button", {
      type: "button",
      class: "record-main",
      "data-acao": "abrir",
    });
    const topo = el("span", { class: "record-top" });
    topo.append(
      el("span", { class: "record-name" }, c.nome),
      el("span", { class: "pill", "data-estado": c.estado }, c.estado),
    );
    const meta = el("span", { class: "record-meta" });
    meta.append(
      el("span", {}, `ID ${c.contacto || "—"}`),
      el("span", {}, c.numero),
    );
    principal.append(topo, meta);

    const eliminar = el(
      "button",
      {
        type: "button",
        class: "record-del",
        "data-acao": "eliminar",
        "aria-label": `Eliminar contrato de ${c.nome}`,
        title: "Eliminar",
      },
      "×",
    );

    li.append(principal, eliminar);
    return li;
  }

  function renderLista() {
    const termo = normalizar(pesquisaEl.value.trim());
    const visiveis = contratos.filter(
      (c) =>
        !termo ||
        normalizar(`${c.nome} ${c.contacto} ${c.numero}`).includes(termo),
    );

    contadorEl.textContent = termo
      ? `${visiveis.length} de ${contratos.length}`
      : `${contratos.length} guardado${contratos.length === 1 ? "" : "s"}`;

    listaEl.replaceChildren();

    if (!visiveis.length) {
      const mensagem = contratos.length
        ? "Nenhum contrato corresponde à pesquisa."
        : "Ainda não há contratos guardados. Preenche o formulário e escolhe “Guardar no Registo”.";
      listaEl.append(el("li", { class: "record-empty" }, mensagem));
      return;
    }

    visiveis.forEach((c) => listaEl.append(criarItem(c)));
  }

  /* ---------- Ações ---------- */

  // Numeração incremental: INEM-<ano>-<sequência>. O ano muda, a sequência continua.
  const PADRAO_NUMERO = /^INEM-\d{4}-(\d+)$/i;

  function sequenciaDe(numero) {
    const partes = PADRAO_NUMERO.exec(numero || "");
    return partes ? parseInt(partes[1], 10) : 0;
  }

  function lerContador() {
    try {
      return parseInt(localStorage.getItem(CHAVE_CONTADOR), 10) || 0;
    } catch {
      return 0;
    }
  }

  // Maior sequência já usada: conta os contratos existentes e também os eliminados.
  // Se o registo estiver vazio, a contagem recomeça do 1.
  function maiorSequencia() {
    if (!contratos.length) return 0;
    return Math.max(
      lerContador(),
      ...contratos.map((c) => sequenciaDe(c.numero)),
    );
  }

  function registarSequencia() {
    try {
      localStorage.setItem(CHAVE_CONTADOR, String(maiorSequencia()));
    } catch {
      /* sem armazenamento: a sequência continua a ser deduzida dos contratos */
    }
  }

  function proximoNumero() {
    const sequencia = maiorSequencia() + 1;
    return `INEM-${new Date().getFullYear()}-${String(sequencia).padStart(4, "0")}`;
  }

  function gerarNumero() {
    campos.numero.value = proximoNumero();
    renderDocumento();
  }

  function guardar(mensagemSucesso) {
    const dados = lerForm();

    if (!dados.nome) return erro("Indica o nome completo (IC).", "#nome");
    if (!dados.contacto) return erro("Indica o contacto.", "#contacto");
    if (!dados.cargo) return erro("Escolhe o cargo ou função.", "#cargo");
    if (dados.admissao && dados.validade && dados.validade < dados.admissao) {
      return erro(
        "A data de validade não pode ser anterior à data de admissão.",
        "#validade",
      );
    }

    if (!dados.numero) {
      gerarNumero();
      dados.numero = campos.numero.value.trim();
    }

    const duplicado = contratos.find(
      (c) =>
        c.numero.toLowerCase() === dados.numero.toLowerCase() &&
        c.id !== idAtual,
    );
    if (duplicado) {
      return erro(
        `O nº ${dados.numero} já pertence ao contrato de ${duplicado.nome}.`,
        "#numero",
      );
    }

    const agora = new Date().toISOString();
    const existente = contratos.find((c) => c.id === idAtual);

    if (existente) {
      Object.assign(existente, dados, { atualizadoEm: agora });
    } else {
      const novo = { id: novoId(), ...dados, atualizadoEm: agora };
      contratos.unshift(novo);
      idAtual = novo.id;
    }

    if (!persistir()) return false;
    registarSequencia();

    renderLista();
    toast(
      mensagemSucesso ||
        (existente
          ? "Contrato atualizado no registo."
          : "Contrato guardado no registo."),
    );
    return true;
  }

  function renovar() {
    const base = campos.validade.value || hojeISO();
    const novaValidade = adicionarDias(base, 30);

    campos.validade.value = novaValidade;
    campos.estado.value = "Ativo";
    renderDocumento();

    const textoData = formatarData(novaValidade);
    if (idAtual && contratos.some((c) => c.id === idAtual)) {
      guardar(`Contrato renovado até ${textoData} e guardado.`);
    } else {
      toast(`Renovado até ${textoData}. Ainda não está guardado no registo.`);
    }
  }

  function novoContrato() {
    form.reset();
    idAtual = null;
    renderDocumento();
    renderLista();
    campos.nome.focus();
  }

  function abrir(id) {
    const contrato = contratos.find((c) => c.id === id);
    if (!contrato) return;

    idAtual = contrato.id;
    preencherForm(contrato);
    renderDocumento();
    renderLista();

    if (window.matchMedia("(max-width: 1180px)").matches) {
      folhaEl.scrollIntoView({
        behavior: prefereMenosMovimento() ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  function eliminar(id) {
    const contrato = contratos.find((c) => c.id === id);
    if (!contrato) return;
    if (
      !confirm(
        `Eliminar o contrato ${contrato.numero} de ${contrato.nome}?\nEsta ação não pode ser anulada.`,
      )
    )
      return;

    contratos = contratos.filter((c) => c.id !== id);
    if (idAtual === id) idAtual = null;
    persistir();
    if (!contratos.length) {
      try {
        localStorage.removeItem(CHAVE_CONTADOR);
      } catch {
        /* sem armazenamento: nada a limpar */
      }
    }
    renderLista();
    toast("Contrato eliminado.");
  }

  /* ---------- Backup JSON ---------- */

  function exportar() {
    if (!contratos.length) {
      toast("Não há contratos para exportar.", "erro");
      return;
    }

    const conteudo = {
      app: "inem-contratos",
      versao: 1,
      exportadoEm: new Date().toISOString(),
      contratos,
    };
    const blob = new Blob([JSON.stringify(conteudo, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const ligacao = el("a", {
      href: url,
      download: `contratos-inem-${hojeISO()}.json`,
    });

    document.body.append(ligacao);
    ligacao.click();
    ligacao.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast(`${contratos.length} contrato(s) exportado(s).`);
  }

  async function importar(ficheiro) {
    if (!ficheiro) return;

    let dados;
    try {
      dados = JSON.parse(await ficheiro.text());
    } catch {
      toast("O ficheiro não é um JSON válido.", "erro");
      return;
    }

    const bruto = Array.isArray(dados)
      ? dados
      : dados && Array.isArray(dados.contratos)
        ? dados.contratos
        : null;
    if (!bruto) {
      toast(
        "Formato inesperado: não foram encontrados contratos no ficheiro.",
        "erro",
      );
      return;
    }

    const validos = bruto.map(sanitizar).filter(Boolean);
    if (!validos.length) {
      toast("O ficheiro não contém contratos válidos.", "erro");
      return;
    }

    const chave = (c) => c.numero.toLowerCase();
    const porNumero = new Map(contratos.map((c) => [chave(c), c]));
    const aSubstituir = validos.filter((c) => porNumero.has(chave(c))).length;

    if (
      aSubstituir &&
      !confirm(
        `${aSubstituir} contrato(s) já existem com o mesmo nº e vão ser substituídos pelos dados do ficheiro. Continuar?`,
      )
    ) {
      return;
    }

    let novos = 0;
    let substituidos = 0;

    validos.forEach((c) => {
      const existente = porNumero.get(chave(c));
      if (existente) {
        Object.assign(existente, c, { id: existente.id });
        substituidos++;
      } else {
        if (contratos.some((x) => x.id === c.id)) c.id = novoId();
        contratos.unshift(c);
        porNumero.set(chave(c), c);
        novos++;
      }
    });

    if (!persistir()) return;
    registarSequencia();

    renderLista();
    const ignorados = bruto.length - validos.length;
    toast(
      `Importação concluída: ${novos} novo(s), ${substituidos} atualizado(s)` +
        (ignorados ? `, ${ignorados} ignorado(s).` : "."),
    );
  }

  /* ---------- Título da página (o navegador usa-o como nome do PDF) ---------- */

  function atualizarTitulo() {
    const dados = lerForm();
    const limpar = (texto) => texto.replace(/[\\/:*?"<>|]/g, "").trim();
    const partes = [limpar(dados.numero), limpar(dados.nome)].filter(Boolean);
    document.title = partes.length
      ? ["Contrato Trabalho", ...partes].join(" - ")
      : TITULO_BASE;
  }

  /* ---------- Eventos ---------- */

  form.addEventListener("input", renderDocumento);

  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    guardar();
  });

  $("#btn-gerar").addEventListener("click", gerarNumero);
  $("#btn-renovar").addEventListener("click", renovar);
  $("#btn-novo").addEventListener("click", novoContrato);
  $("#btn-imprimir").addEventListener("click", () => {
    atualizarTitulo();
    window.print();
  });
  $("#btn-exportar").addEventListener("click", exportar);
  $("#btn-importar").addEventListener("click", () => ficheiroEl.click());

  ficheiroEl.addEventListener("change", async () => {
    await importar(ficheiroEl.files[0]);
    ficheiroEl.value = "";
  });

  pesquisaEl.addEventListener("input", renderLista);

  listaEl.addEventListener("click", (evento) => {
    const alvo = evento.target.closest("[data-acao]");
    if (!alvo) return;
    const item = alvo.closest(".record");
    if (!item) return;

    if (alvo.dataset.acao === "abrir") abrir(item.dataset.id);
    if (alvo.dataset.acao === "eliminar") eliminar(item.dataset.id);
  });

  campos.contacto.addEventListener("input", (evento) => {
    evento.target.value = mascararContacto(evento.target.value);
    renderDocumento();
  });

  /* ---------- Arranque ---------- */

  renderLista();
  renderDocumento();
})();
