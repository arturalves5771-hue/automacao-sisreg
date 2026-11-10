console.log("AUTOMAÇÃO SISREG: content.js carregado");

/*
=========================================================
PARTE 1: COMUNICAÇÃO COM NOSSA PÁGINA HTML
=========================================================
*/
window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "CONSULTAR_DADOS_CNS") {
        const numero = String(event.data.numero || "").replace(/\D/g, "");
        if (!numero) return;
        chrome.runtime.sendMessage({
            type: "CONSULTAR_DADOS_CNS",
            numero: numero
        });
        return;
    }
    if (event.data.type === "ABRIR_FICHA_CNS") {
        const id = String(event.data.id || "").replace(/\D/g, "");
        if (id) chrome.runtime.sendMessage({ type: "ABRIR_FICHA_CNS", id: id });
        return;
    }
    if (event.data.type === "RETORNAR_SOLICITACOES_CNS") {
        chrome.runtime.sendMessage({ type: "RETORNAR_SOLICITACOES_CNS" });
        return;
    }

    if (event.data.type === "SISREG_LOGIN") {
        if (!event.data.username || !event.data.password) return;
        chrome.runtime.sendMessage({
            type: "INICIAR_LOGIN_SISREG",
            username: event.data.username,
            password: event.data.password
        });
        return;
    }

    if (event.data.type === "EXPORTAR_CSV") {
        chrome.runtime.sendMessage({
            type: "EXPORTAR_CSV",
            dataInicial: event.data.dataInicial,
            dataFinal: event.data.dataFinal
        });
        return;
    }

    if (event.data.type === "ARQUIVO_SALVO_DIRETO") {
        chrome.runtime.sendMessage({
            type: "ARQUIVO_SALVO_DIRETO",
            nomeArquivo: event.data.nomeArquivo
        });
        return;
    }

    if (event.data.type === "ERRO_SALVAR_ARQUIVO") {
        chrome.runtime.sendMessage({
            type: "ERRO_SALVAR_ARQUIVO",
            mensagem: event.data.mensagem
        });
        return;
    }
});

/*
=========================================================
PARTE 2: RECEBER RESPOSTA DO BACKGROUND
=========================================================
*/
chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === "DADOS_CNS_SUCESSO") {
        window.postMessage({
            type: "DADOS_CNS_SUCESSO",
            jsonData: message.jsonData,
            consultas: message.consultas || []
        }, "*");
        return;
    }
    if (message.type === "DADOS_CNS_FICHA") {
        window.postMessage({ type: "DADOS_CNS_FICHA", id: message.id, html: message.html || "" }, "*");
        return;
    }
    if (message.type === "DADOS_CNS_FICHA_ERRO") {
        window.postMessage({ type: "DADOS_CNS_FICHA_ERRO", mensagem: message.mensagem || "" }, "*");
        return;
    }
    if (message.type === "SISREG_SESSAO_EXPIRADA") {
        window.postMessage({ type: "SISREG_SESSAO_EXPIRADA", mensagem: message.mensagem || "A sessão do SISREG foi encerrada. Entre novamente." }, "*");
        return;
    }

    if (message.type === "CONSULTA_CNS_ERRO") {
        window.postMessage({
            type: "CONSULTA_CNS_ERRO",
            mensagem: message.mensagem
        }, "*");
        return;
    }

    if (message.type === "LOGIN_SISREG_SUCESSO") {
        window.postMessage({ type: "LOGIN_SISREG_SUCESSO" }, "*");
        return;
    }

    if (message.type === "LOGIN_SISREG_ERRO") {
        window.postMessage({ type: "LOGIN_SISREG_ERRO", mensagem: message.mensagem }, "*");
        return;
    }

    if (message.type === "ARQUIVO_CSV_PRONTO") {
        window.postMessage({
            type: "ARQUIVO_CSV_PRONTO",
            dataUrl: message.dataUrl,
            nomeArquivo: message.nomeArquivo
        }, "*");
        return;
    }

    if (message.type === "EXPORTACAO_SUCESSO") {
        window.postMessage({ type: "EXPORTACAO_SUCESSO", mensagem: message.mensagem }, "*");
        return;
    }

    if (message.type === "EXPORTACAO_ERRO") {
        window.postMessage({ type: "EXPORTACAO_ERRO", mensagem: message.mensagem }, "*");
        return;
    }
});

/*
=========================================================
PARTE 3: CÓDIGO EXCLUSIVO DO SISREG (sisregiii.saude.gov.br)
=========================================================
*/
if (location.hostname === "sisregiii.saude.gov.br") {
    console.log("EXTENSÃO EXECUTANDO DENTRO DO SISREG.");

    let sessaoEncerradaJaNotificada = false;

    function textoIndicaSessaoEncerrada(texto) {
        const normalizado = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        return normalizado.includes("este operador efetuou logon em outra estacao de trabalho") ||
            normalizado.includes("sua sessao foi finalizada pelo servidor") ||
            normalizado.includes("sessao expirada") ||
            normalizado.includes("sessao foi finalizada") ||
            normalizado.includes("usuario nao autenticado") ||
            (normalizado.includes("erro de sistema") && normalizado.includes("outra estacao de trabalho"));
    }

    function notificarSessaoSISREGEncerrada(mensagem) {
        if (sessaoEncerradaJaNotificada) return;
        sessaoEncerradaJaNotificada = true;
        chrome.runtime.sendMessage({
            type: "SISREG_SESSAO_EXPIRADA",
            mensagem: mensagem || "O SISREG encerrou sua sessão. Entre novamente."
        });
    }

    async function verificarRespostaSISREG(resposta) {
        if (!resposta) return false;
        if ([401, 403, 419, 440].includes(resposta.status)) {
            notificarSessaoSISREGEncerrada("O SISREG recusou a requisição (HTTP " + resposta.status + "). Entre novamente.");
            return true;
        }
        try {
            const texto = await resposta.clone().text();
            if (textoIndicaSessaoEncerrada(texto)) {
                notificarSessaoSISREGEncerrada("O SISREG encerrou sua sessão porque houve um novo acesso em outra estação. Entre novamente.");
                return true;
            }
            if (resposta.redirected && /\/cgi-bin\/index(?:$|[?#])/i.test(resposta.url) &&
                /name=["']usuario["']|id=["']usuario["']/i.test(texto)) {
                notificarSessaoSISREGEncerrada("Sua sessão do SISREG não está mais autenticada. Entre novamente.");
                return true;
            }
        } catch (erro) {}
        return false;
    }

    function verificarDocumentoPorSessaoEncerrada() {
        if (sessaoEncerradaJaNotificada) return;
        const documentoErro = percorrerDocumentos(function (doc) {
            const texto = doc.body ? (doc.body.innerText || doc.body.textContent || "") : "";
            return textoIndicaSessaoEncerrada(texto) ? doc : null;
        });
        if (documentoErro) {
            notificarSessaoSISREGEncerrada("O SISREG encerrou sua sessão porque houve um novo acesso em outra estação. Entre novamente.");
        }
    }

    setTimeout(verificarDocumentoPorSessaoEncerrada, 300);
    setInterval(verificarDocumentoPorSessaoEncerrada, 900);
    if (document.documentElement && window.MutationObserver) {
        const observadorSessao = new MutationObserver(verificarDocumentoPorSessaoEncerrada);
        observadorSessao.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }

    /*
    -----------------------------------------------------
    Verifica estado da tela e presença de erros de login
    -----------------------------------------------------
    */
    function verificarEstadoSISREG() {
        const campoUsuario = document.querySelector("#usuario");
        const campoSenha = document.querySelector("#senha");
        const telaLogin = !!campoUsuario && !!campoSenha;

        const textoPagina = document.body ? document.body.innerText : "";
        const erroLogin = telaLogin && (
            textoPagina.includes("Login ou senha incorreto") ||
            textoPagina.includes("incorreto(s)") ||
            textoPagina.includes("Senha inválida") ||
            textoPagina.includes("Usuário não encontrado")
        );

        return { telaLogin, erroLogin };
    }

    function informarEstadoSISREG() {
        const estado = verificarEstadoSISREG();
        chrome.runtime.sendMessage({
            type: "SISREG_ESTADO",
            telaLogin: estado.telaLogin,
            erroLogin: estado.erroLogin
        });
    }

    setTimeout(informarEstadoSISREG, 800);

    let ultimoEstado = null;
    let ultimoErro = null;

    setInterval(function () {
        const estado = verificarEstadoSISREG();

        if (estado.telaLogin !== ultimoEstado || estado.erroLogin !== ultimoErro) {
            ultimoEstado = estado.telaLogin;
            ultimoErro = estado.erroLogin;

            chrome.runtime.sendMessage({
                type: "SISREG_ESTADO",
                telaLogin: estado.telaLogin,
                erroLogin: estado.erroLogin
            });
        }
    }, 500);

    /*
    -----------------------------------------------------
    RECEBER E PREENCHER CREDENCIAIS DE LOGIN
    -----------------------------------------------------
    */
    chrome.runtime.onMessage.addListener(function (message) {
        if (message.type !== "PREENCHER_LOGIN") return;

        const campoUsuario = document.querySelector("#usuario");
        const campoSenha = document.querySelector("#senha");

        if (!campoUsuario || !campoSenha) return;

        campoUsuario.value = message.username;
        campoUsuario.dispatchEvent(new Event("input", { bubbles: true }));
        campoUsuario.dispatchEvent(new Event("change", { bubbles: true }));

        campoSenha.value = message.password;
        campoSenha.dispatchEvent(new Event("input", { bubbles: true }));
        campoSenha.dispatchEvent(new Event("change", { bubbles: true }));

        setTimeout(function () {
            const botaoEntrar = document.querySelector('[name="entrar"]');
            if (botaoEntrar) botaoEntrar.click();
        }, 500);
    });


    /*
    -----------------------------------------------------
    CONSULTA ISOLADA POR CNS / CPF
    -----------------------------------------------------
    */
    /*
    -----------------------------------------------------
    CONSULTA CNS / CPF — SUPORTE À ESTRUTURA EM FRAMES
    -----------------------------------------------------
    O SISREG pode carregar o menu e o CADWEB em frames.
    Por isso, a busca percorre o documento principal e
    os frames acessíveis da mesma origem.
    */
    function percorrerDocumentos(callback, documento, visitados) {
        documento = documento || document;
        visitados = visitados || new Set();

        if (!documento || visitados.has(documento)) return null;
        visitados.add(documento);

        try {
            const encontrado = callback(documento);
            if (encontrado) return encontrado;

            const frames = documento.querySelectorAll("iframe, frame");
            for (const frame of frames) {
                try {
                    const interno = frame.contentDocument;
                    const resultado = percorrerDocumentos(callback, interno, visitados);
                    if (resultado) return resultado;
                } catch (erro) {
                    // Frames de outra origem não podem ser acessados.
                }
            }
        } catch (erro) {
            // Continua procurando nos demais documentos acessíveis.
        }

        return null;
    }

    function buscarElementoSISREG(seletor) {
        return percorrerDocumentos(function (doc) {
            return doc.querySelector(seletor);
        });
    }

    function aguardarElementoCNS(seletor, tempoMaximo) {
        return new Promise(function (resolve, reject) {
            const inicio = Date.now();
            const timer = setInterval(function () {
                const elemento = buscarElementoSISREG(seletor);
                if (elemento) {
                    clearInterval(timer);
                    resolve(elemento);
                    return;
                }
                if (Date.now() - inicio >= tempoMaximo) {
                    clearInterval(timer);
                    reject(new Error("Não encontrei input[name='nu_cns'] na página principal nem nos frames do SISREG."));
                }
            }, 300);
        });
    }

    function localizarDocumentoResultado() {
        return percorrerDocumentos(function (doc) {
            const texto = doc.body ? doc.body.innerText : "";
            if (/CONSULTA AO CADASTRO DE PACIENTES SUS/i.test(texto)) return doc;
            return null;
        });
    }

    function extrairDadosPaginaCNS(documento) {
        const doc = documento || localizarDocumentoResultado() || document;
        const campos = [];

        doc.querySelectorAll("input:not([type='password']):not([type='hidden']), select, textarea").forEach(function (campo) {
            const rotulo = campo.labels && campo.labels.length
                ? campo.labels[0].innerText.trim()
                : (campo.name || campo.id || campo.getAttribute("aria-label") || "");
            const valor = campo.tagName === "SELECT"
                ? (campo.options[campo.selectedIndex] ? campo.options[campo.selectedIndex].text : "")
                : campo.value;
            if (rotulo || valor) campos.push({ campo: rotulo, valor: valor });
        });

        const tabelas = [];
        doc.querySelectorAll("table").forEach(function (tabela) {
            const linhas = [];
            tabela.querySelectorAll("tr").forEach(function (linha) {
                const celulas = Array.from(linha.querySelectorAll("th, td"))
                    .map(function (celula) { return celula.innerText.trim(); });
                if (celulas.some(Boolean)) linhas.push(celulas);
            });
            if (linhas.length) tabelas.push(linhas);
        });

        return {
            url: doc.location ? doc.location.href : location.href,
            titulo: doc.title || document.title,
            campos: campos,
            tabelas: tabelas,
            texto: doc.body ? doc.body.innerText.trim() : ""
        };
    }

    let consultaCNSResultadoEnviado = false;
    let resultadoCNSProcessado = false;
    let preenchimentoSolicitacoesEmAndamento = false;

    function enviarResultadoCNS(dados) {
        if (consultaCNSResultadoEnviado) return;
        consultaCNSResultadoEnviado = true;

        chrome.runtime.sendMessage({
            type: "DADOS_CNS_SUCESSO",
            jsonData: dados
        });
    }

    function extrairNumeroCNS(dados, numeroOriginal) {
        const original = String(numeroOriginal || "").replace(/\D/g, "");
        if (original.length === 15) return original;

        // Primeiro tenta localizar o CNS nos campos estruturados do CADWEB.
        if (dados && Array.isArray(dados.campos)) {
            for (const item of dados.campos) {
                const rotulo = String(item.campo || "");
                const valor = String(item.valor || "").replace(/\D/g, "");
                if (/(CNS|CART[AÃ]O.*SUS|CART[AÃ]O NACIONAL)/i.test(rotulo) && valor.length === 15) {
                    return valor;
                }
            }
        }

        // Depois procura o CNS identificado no texto bruto da página.
        const texto = String(dados && dados.texto || "");
        const padroes = [
            /(?:CNS|Cart[aã]o\s*(?:Nacional\s*)?de?\s*Sa[uú]de)\s*[:\-]?\s*(\d{3}\s*\d{4}\s*\d{4}\s*\d{4})/i,
            /(?:CNS|Cart[aã]o\s*(?:Nacional\s*)?de?\s*Sa[uú]de)[\s\S]{0,80}?(\d{15})/i
        ];

        for (const padrao of padroes) {
            const resultado = texto.match(padrao);
            if (resultado) {
                const numero = resultado[1].replace(/\D/g, "");
                if (numero.length === 15) return numero;
            }
        }

        // Última alternativa: procura uma sequência de 15 dígitos no texto.
        const sequencias = texto.match(/\b\d{15}\b/g) || [];
        return sequencias.length === 1 ? sequencias[0] : "";
    }

    function normalizarTextoMenu(texto) {
        return String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }

    function localizarOpcaoMenuSISREG(tipo) {
        const seletor = "a, button, input, [onclick], [role='menuitem'], [title], [alt], td, span";
        return percorrerDocumentos(function (doc) {
            const elementos = Array.from(doc.querySelectorAll(seletor));
            const encontrados = elementos.filter(function (elemento) {
                const texto = normalizarTextoMenu(
                    (elemento.innerText || elemento.textContent || "") + " " +
                    (elemento.value || "") + " " +
                    (elemento.getAttribute("title") || "") + " " +
                    (elemento.getAttribute("alt") || "")
                );
                if (!texto) return false;

                if (tipo === "consulta_amb") {
                    return texto === "CONSULTA AMB";
                }

                return texto === "SOLICITACOES" ||
                    texto === "SOLICITACOES AMBULATORIAIS" ||
                    texto.startsWith("SOLICITACOES ") ||
                    /\\bSOLICITACOES\\b/.test(texto);
            });

            // Prioriza o elemento com o texto mais específico/curto.
            encontrados.sort(function (a, b) {
                const ta = (a.innerText || a.textContent || a.value || "").trim().length;
                const tb = (b.innerText || b.textContent || b.value || "").trim().length;
                return ta - tb;
            });

            return encontrados[0] || null;
        });
    }

    function aguardarElementoSISREG(seletor, tempoMaximo, mensagemErro) {
        return new Promise(function (resolve, reject) {
            const inicio = Date.now();
            const timer = setInterval(function () {
                const elemento = buscarElementoSISREG(seletor);
                if (elemento) {
                    clearInterval(timer);
                    resolve(elemento);
                    return;
                }

                if (Date.now() - inicio >= tempoMaximo) {
                    clearInterval(timer);
                    reject(new Error(mensagemErro || "Tempo esgotado aguardando o elemento do SISREG: " + seletor));
                }
            }, 300);
        });
    }

    function aguardarOpcaoMenuSISREG(tipo, tempoMaximo) {
        return new Promise(function (resolve, reject) {
            const inicio = Date.now();
            const timer = setInterval(function () {
                const elemento = localizarOpcaoMenuSISREG(tipo);
                if (elemento) {
                    clearInterval(timer);
                    resolve(elemento);
                    return;
                }

                if (Date.now() - inicio >= tempoMaximo) {
                    clearInterval(timer);
                    reject(new Error(tipo === "consulta_amb"
                        ? "Não localizei o menu superior CONSULTA AMB."
                        : "Não localizei a opção SOLICITAÇÕES dentro do menu CONSULTA AMB."));
                }
            }, 300);
        });
    }

    function preencherCampoComEventos(campo, valor) {
        const numero = String(valor || "").replace(/\D/g, "");
        if (!campo || numero.length !== 15) {
            throw new Error("O CNS capturado não possui 15 dígitos. O campo não será preenchido.");
        }

        campo.focus();
        campo.value = numero;

        // Dispara os eventos usuais de atualização do formulário.
        campo.dispatchEvent(new Event("input", { bubbles: true }));

        // A tela do SISREG usa onkeypress e onkeyup para atualizar a validação.
        for (const digito of numero) {
            const codigo = Number(digito);
            campo.dispatchEvent(new KeyboardEvent("keypress", {
                key: digito,
                code: "Digit" + digito,
                keyCode: 48 + codigo,
                which: 48 + codigo,
                bubbles: true,
                cancelable: true
            }));
            campo.dispatchEvent(new KeyboardEvent("keyup", {
                key: digito,
                code: "Digit" + digito,
                keyCode: 48 + codigo,
                which: 48 + codigo,
                bubbles: true
            }));
        }

        // O evento change executa o onchange="atualizarIndicadorCampoObrigatorio()".
        campo.dispatchEvent(new Event("change", { bubbles: true }));
        campo.blur();
    }

    function normalizarCabecalhoSolicitacao(valor) {
        return normalizarTextoMenu(valor).replace(/[^A-Z0-9]/g, "");
    }

    function extrairValorDoTituloSolicitacao(titulos, rotulos) {
        const texto = String(titulos || "").replace(/\r/g, "\n");
        const proximos = "(?:Número CNS|Nome Paciente|Nome da Mãe|Data Nascimento|Data de Nascimento|Descrição CID|CID|Descrição)";
        for (const rotulo of rotulos) {
            const padrao = new RegExp("(?:^|[\\n;|])\\s*" + rotulo +
                "\\s*[:：\\-]?\\s*([\\s\\S]*?)(?=\\s*(?:\\n|;|\\||" + proximos + ")\\s*[:：\\-]|$)", "i");
            const achado = texto.match(padrao);
            if (achado && achado[1]) return achado[1].trim().replace(/\s+/g, " ");
        }
        return "";
    }

    function extrairConsultasSolicitacoes(documento) {
        const doc = documento || document;
        const linhas = Array.from(doc.querySelectorAll("tr.linha_selecionavel"));
        const resultado = [];
        const ids = new Set();

        linhas.forEach(function (linha) {
            const celulas = Array.from(linha.querySelectorAll("td"));
            if (!celulas.length) return;

            const onclick = [
                linha.getAttribute("onclick") || "",
                ...Array.from(linha.querySelectorAll("[onclick]")).map(function (el) {
                    return el.getAttribute("onclick") || "";
                })
            ].join(" ");
            const idMatch = onclick.match(/visualizaFicha\s*\(\s*['"]?(\d+)/i);
            const textos = celulas.map(function (celula) {
                return (celula.innerText || celula.textContent || "").trim().replace(/\s+/g, " ");
            });
            const idVisivel = textos.join(" ").match(/\b(\d{6,})\b/);
            const id = idMatch ? idMatch[1] : (idVisivel ? idVisivel[1] : "");
            const assinatura = id || textos.join("|");
            if (ids.has(assinatura)) return;
            ids.add(assinatura);

            const tabela = linha.closest("table");
            let cabecalhos = [];
            if (tabela) {
                const linhasTabela = Array.from(tabela.querySelectorAll("tr"));
                const linhaCabecalho = tabela.querySelector("thead tr") ||
                    linhasTabela.find(function (tr) {
                        return tr.querySelector("th");
                    }) ||
                    linhasTabela.find(function (tr) {
                        const textoCabecalho = normalizarCabecalhoSolicitacao(
                            Array.from(tr.querySelectorAll("td")).map(function (td) {
                                return td.innerText || td.textContent || "";
                            }).join(" ")
                        );
                        return textoCabecalho.includes("DATASOLICITACAO") ||
                            textoCabecalho.includes("PROCEDIMENTO") ||
                            textoCabecalho.includes("MUNICIPIO");
                    });
                if (linhaCabecalho) {
                    cabecalhos = Array.from(linhaCabecalho.querySelectorAll("th,td")).map(function (celula) {
                        return (celula.innerText || celula.textContent || "").trim();
                    });
                }
            }

            const valores = {};
            cabecalhos.forEach(function (cabecalho, indice) {
                if (indice < textos.length && cabecalho) {
                    valores[normalizarCabecalhoSolicitacao(cabecalho)] = textos[indice];
                }
            });

            function porCabecalho(aliases) {
                const chaves = Object.keys(valores);
                for (const alias of aliases) {
                    const alvo = normalizarCabecalhoSolicitacao(alias);
                    const chave = chaves.find(function (item) {
                        return item === alvo || item.includes(alvo);
                    });
                    if (chave && valores[chave]) return valores[chave];
                }
                return "";
            }

            function porCabecalhoDataExecucao() {
                const chaves = Object.keys(valores);
                const chave = chaves.find(function (item) {
                    return ((item.includes("EXEC") && !item.includes("EXECUTANTE")) ||
                        item.includes("REALIZACAO") || item.includes("REALIZADA")) &&
                        valores[item];
                });
                return chave ? valores[chave] : "";
            }

            const titulos = celulas.map(function (celula) {
                return celula.getAttribute("title") || "";
            }).filter(Boolean).join("\n");
            const tituloCID = celulas.map(function (celula, indice) {
                const cab = normalizarCabecalhoSolicitacao(cabecalhos[indice] || "");
                return cab.includes("CID") ? (celula.getAttribute("title") || "") : "";
            }).filter(Boolean).join(" ");

            const cnsTitulo = extrairValorDoTituloSolicitacao(titulos, ["Número CNS"]);
            const nascimentoTitulo = extrairValorDoTituloSolicitacao(titulos, ["Data Nascimento", "Data de Nascimento"]);
            const descricaoTitulo = extrairValorDoTituloSolicitacao(tituloCID || titulos, ["Descrição CID", "Descrição"]) ||
                String(tituloCID || "").trim();

            resultado.push({
                id: id,
                cns: (cnsTitulo.match(/\d{15}/) || [porCabecalho(["CNS"])])[0] || "",
                dataNascimento: nascimentoTitulo,
                dataSolicitacao: porCabecalho(["Data Solicitação", "Data da Solicitação"]),
                municipio: porCabecalho(["Município", "Municipio"]),
                idade: porCabecalho(["Idade"]),
                procedimento: porCabecalho(["Procedimento"]),
                cid: porCabecalho(["CID"]),
                cidDescricao: descricaoTitulo,
                solicitante: porCabecalho(["Solicitante"]),
                executante: porCabecalho(["Executante"]),
                dataExecucao: porCabecalho(["Data Execução", "Data da Execução", "Data de Execução", "Dt Execução", "Data Realização", "Data da Realização"]) || porCabecalhoDataExecucao() || (celulas.length > 11 ? textos[11] : ""),
                situacao: porCabecalho(["Situação", "Situacao"])
            });
        });
        return resultado;
    }

    function localizarBotaoPesquisaSolicitacoes(campo) {
        const formulario = campo.form || campo.closest("form");
        const candidatos = formulario
            ? Array.from(formulario.querySelectorAll("button,input[type='submit'],input[type='button'],input[type='image'],[onclick]"))
            : Array.from(campo.ownerDocument.querySelectorAll("button,input[type='submit'],input[type='button'],input[type='image'],[onclick]"));

        return candidatos.find(function (elemento) {
            const texto = normalizarTextoMenu(
                (elemento.innerText || elemento.textContent || "") + " " +
                (elemento.value || "") + " " +
                (elemento.getAttribute("title") || "") + " " +
                (elemento.getAttribute("alt") || "") + " " +
                (elemento.getAttribute("name") || "")
            );
            return /PESQUISAR|CONSULTAR|BUSCAR|FILTRAR/.test(texto);
        }) || (formulario ? formulario.querySelector("button[type='submit'],input[type='submit']") : null);
    }

    function aguardarResultadoConsultas(documento, tempoMaximo) {
        return new Promise(function (resolve) {
            const inicio = Date.now();
            const timer = setInterval(function () {
                const documentoAtual = percorrerDocumentos(function (doc) {
                    const encontrouLinhas = doc.querySelectorAll("tr.linha_selecionavel").length > 0;
                    const textoDoc = doc.body ? normalizarTextoMenu(doc.body.innerText) : "";
                    const semResultadoDoc = /NENHUM(A)? (REGISTRO|SOLICITACAO|RESULTADO)|NAO FORAM ENCONTRAD/.test(textoDoc);
                    return encontrouLinhas || semResultadoDoc ? doc : null;
                }) || (buscarElementoSISREG('input[name="cns_paciente"]') || {}).ownerDocument || documento;

                const linhas = documentoAtual.querySelectorAll("tr.linha_selecionavel");
                const texto = documentoAtual.body ? normalizarTextoMenu(documentoAtual.body.innerText) : "";
                const semResultado = /NENHUM(A)? (REGISTRO|SOLICITACAO|RESULTADO)|NAO FORAM ENCONTRAD/.test(texto);
                if (linhas.length || semResultado || Date.now() - inicio >= tempoMaximo) {
                    clearInterval(timer);
                    resolve(extrairConsultasSolicitacoes(documentoAtual));
                }
            }, 350);
        });
    }

    async function concluirPreenchimentoSolicitacoes(cns) {
        if (preenchimentoSolicitacoesEmAndamento) return;
        preenchimentoSolicitacoesEmAndamento = true;

        try {
            const numeroCNS = String(cns || "").replace(/\D/g, "");
            if (numeroCNS.length !== 15) {
                throw new Error("O Cartão SUS armazenado não possui 15 dígitos.");
            }

            const campoCNS = await aguardarElementoSISREG(
                'input[name="cns_paciente"]',
                25000,
                "A página de Solicitações Ambulatoriais foi aberta, mas o campo do CNS não apareceu em até 25 segundos."
            );

            await chrome.runtime.sendMessage({ type: "CONSULTA_CNS_SOLICITACOES_PRONTA" });
            preencherCampoComEventos(campoCNS, numeroCNS);

            const documento = campoCNS.ownerDocument;
            const botaoPesquisar = localizarBotaoPesquisaSolicitacoes(campoCNS);
            if (botaoPesquisar) {
                botaoPesquisar.click();
            } else if (campoCNS.form) {
                ["keydown", "keypress", "keyup"].forEach(function (tipo) {
                    campoCNS.dispatchEvent(new KeyboardEvent(tipo, {
                        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
                    }));
                });
            } else {
                throw new Error("Não encontrei o botão de pesquisa nem o formulário de Solicitações.");
            }

            const consultas = await aguardarResultadoConsultas(documento, 20000);
            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_CONSULTAS_CAPTURADAS",
                consultas: consultas
            });
            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_PREENCHIMENTO_CONCLUIDO"
            });
        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_ERRO",
                mensagem: erro.message || "Não foi possível preencher o CNS na tela de Solicitações Ambulatoriais."
            });
        } finally {
            // Libera a próxima abertura de ficha/retorno à tabela.
            preenchimentoSolicitacoesEmAndamento = false;
        }
    }
    function localizarMenuConsultaAmb() {
        return percorrerDocumentos(function (doc) {
            // No HTML real do SISREG, o pai é um link .sf-with-ul.
            // O texto também contém o indicador » dentro de um span.
            const links = Array.from(doc.querySelectorAll("a.sf-with-ul"));
            return links.find(function (link) {
                const texto = normalizarTextoMenu(link.textContent || link.innerText || "");
                return texto.startsWith("CONSULTA AMB");
            }) || null;
        });
    }

    function abrirMenuConsultaAmb(menuPai) {
        const itemMenu = menuPai.closest("li") || menuPai;
        const janela = menuPai.ownerDocument.defaultView;

        // Superfish abre o submenu ao receber o mouse sobre o LI pai.
        ["mouseover", "mouseenter"].forEach(function (tipo) {
            itemMenu.dispatchEvent(new janela.MouseEvent(tipo, {
                view: janela,
                bubbles: tipo === "mouseover",
                cancelable: true,
                relatedTarget: null
            }));
        });

        // Também dispara os eventos diretamente no link pai, como no uso real do mouse.
        ["mouseover", "mouseenter"].forEach(function (tipo) {
            menuPai.dispatchEvent(new janela.MouseEvent(tipo, {
                view: janela,
                bubbles: tipo === "mouseover",
                cancelable: true,
                relatedTarget: null
            }));
        });

        return itemMenu;
    }

    function aguardarLinkSolicitacoes(documento, tempoMaximo) {
        return new Promise(function (resolve, reject) {
            const seletor = 'a[href="/cgi-bin/gerenciador_solicitacao"]';
            const inicio = Date.now();

            const timer = setInterval(function () {
                // O link pode estar no DOM desde o início, mas oculto.
                // Após o hover, clicamos no próprio link, sem simular clique no submenu.
                const link = documento.querySelector(seletor);
                if (link) {
                    clearInterval(timer);
                    resolve(link);
                    return;
                }

                if (Date.now() - inicio >= tempoMaximo) {
                    clearInterval(timer);
                    reject(new Error(
                        'Não encontrei o link de Solicitações no submenu CONSULTA AMB: ' + seletor
                    ));
                }
            }, 150);
        });
    }

    async function abrirSolicitacoesEPreencher(cns, dadosResultado) {
        try {
            const numeroCNS = String(cns || "").replace(/\D/g, "");
            if (numeroCNS.length !== 15) {
                throw new Error("Não consegui recuperar o Cartão SUS já consultado. Faça uma nova consulta por CNS/CPF.");
            }

            // Mantém os dados do paciente e o CNS em memória no background.
            // A consulta inicial do CADWEB não é repetida.
            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_RESULTADO_CAPTURADO",
                cns: numeroCNS,
                jsonData: dadosResultado || {}
            });

            // Ao voltar de uma ficha, o SISREG normalmente já está na tela
            // SOLICITAÇÕES. Nesse caso, reutiliza diretamente o campo cns_paciente
            // e NÃO reabre a pesquisa inicial nem navega pelo menu novamente.
            const campoSolicitacoesAtual = percorrerDocumentos(function (doc) {
                // A tela principal do SISREG pode estar em /cgi-bin/index,
                // enquanto o conteúdo de Solicitações é carregado em frames.
                // O campo cns_paciente é o identificador confiável da tela;
                // não exigir gerenciador_solicitacao na URL do frame.
                const campo = doc.querySelector('input[name="cns_paciente"]');
                return campo && campo.getClientRects().length ? campo : null;
            });

            if (campoSolicitacoesAtual) {
                await concluirPreenchimentoSolicitacoes(numeroCNS);
                return;
            }

            const menuConsultaAmb = localizarMenuConsultaAmb();
            if (!menuConsultaAmb) {
                throw new Error("Não localizei o menu CONSULTA AMB no SISREG e a tela SOLICITAÇÕES não está aberta.");
            }

            const itemMenu = abrirMenuConsultaAmb(menuConsultaAmb);
            const linkSolicitacoes = await aguardarLinkSolicitacoes(
                menuConsultaAmb.ownerDocument,
                5000
            );

            const submenu = itemMenu.querySelector("ul.sf-menu");
            if (submenu && !submenu.contains(linkSolicitacoes)) {
                throw new Error("O link encontrado não pertence ao submenu de CONSULTA AMB.");
            }

            const nomeFrame = linkSolicitacoes.getAttribute("target") || "f_principal";
            const janelaTopo = menuConsultaAmb.ownerDocument.defaultView.top;
            let janelaDestino = null;

            try {
                janelaDestino = janelaTopo.frames[nomeFrame];
            } catch (erro) {}

            if (!janelaDestino) {
                throw new Error("Não consegui localizar o frame principal do SISREG (" + nomeFrame + ").");
            }

            const urlSolicitacoes = new URL(
                linkSolicitacoes.getAttribute("href"),
                menuConsultaAmb.ownerDocument.location.href
            ).href;

            if (!/\/cgi-bin\/gerenciador_solicitacao(?:[?#]|$)/i.test(urlSolicitacoes)) {
                throw new Error("O link do menu não aponta para a tela oficial de Solicitações Ambulatoriais.");
            }

            // Registra o evento de carregamento ANTES de navegar. Isso funciona mesmo
            // quando o SISREG reutiliza o mesmo frame e a URL já foi visitada antes.
            const carregamento = new Promise(function (resolve, reject) {
                let finalizado = false;
                const temporizador = setTimeout(function () {
                    if (finalizado) return;
                    finalizado = true;
                    janelaDestino.removeEventListener("load", aoCarregar, true);
                    reject(new Error("O SISREG não terminou de carregar novamente a tela SOLICITAÇÕES."));
                }, 25000);

                function aoCarregar() {
                    if (finalizado) return;
                    let urlAtual = "";
                    try { urlAtual = janelaDestino.location.href; } catch (erro) {}
                    if (!/\/cgi-bin\/gerenciador_solicitacao(?:[?#]|$)/i.test(urlAtual)) return;

                    finalizado = true;
                    clearTimeout(temporizador);
                    janelaDestino.removeEventListener("load", aoCarregar, true);
                    resolve();
                }

                janelaDestino.addEventListener("load", aoCarregar, true);
            });

            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_NAVEGACAO_SOLICITACOES_INICIADA"
            });

            // Navega diretamente pelo endereço do próprio link CONSULTA AMB > SOLICITAÇÕES.
            // Assim não depende de um clique que possa ser ignorado por uma ficha antiga/AJAX.
            janelaDestino.location.href = urlSolicitacoes;
            await carregamento;

            // A nova tela já carregou. Reaplica apenas o CNS que já estava armazenado.
            await concluirPreenchimentoSolicitacoes(numeroCNS);
        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_ERRO",
                mensagem: erro.message || "Não foi possível reabrir CONSULTA AMB > SOLICITAÇÕES."
            });
        }
    }
    async function processarResultadoInicial(documento) {
        if (resultadoCNSProcessado) return;
        resultadoCNSProcessado = true;

        const dados = extrairDadosPaginaCNS(documento);
        const cns = extrairNumeroCNS(dados, "");

        if (!cns || cns.length !== 15) {
            chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_ERRO",
                mensagem: "A pesquisa inicial foi concluída, mas não consegui identificar um Cartão do SUS com 15 dígitos no resultado do CADWEB."
            });
            return;
        }

        await abrirSolicitacoesEPreencher(cns, dados);
    }

    async function executarConsultaCNS(numero) {
        try {
            let campo = buscarElementoSISREG('input[name="nu_cns"]');

            // A tela de CNS só é disponibilizada depois de abrir CONSULTA AMB.
            // Não procurar/clicar em qualquer ocorrência de "CNS" espalhada no SISREG.
            if (!campo) {
                const menuConsultaAmb = localizarMenuConsultaAmb();
                if (!menuConsultaAmb) {
                    throw new Error("Não localizei o menu CONSULTA AMB antes de abrir a pesquisa CNS.");
                }

                const itemMenu = abrirMenuConsultaAmb(menuConsultaAmb);
                const inicioMenu = Date.now();
                let opcaoCNS = null;

                while (!opcaoCNS && Date.now() - inicioMenu < 10000) {
                    const candidatos = Array.from(itemMenu.querySelectorAll(
                        "ul a, ul button, ul [onclick], ul [role='menuitem'], a, button, [onclick]"
                    ));
                    opcaoCNS = candidatos.find(function (elemento) {
                        if (elemento === menuConsultaAmb) return false;
                        const texto = normalizarTextoMenu(
                            (elemento.innerText || elemento.textContent || "") + " " +
                            (elemento.value || "") + " " +
                            (elemento.getAttribute("title") || "")
                        );
                        const destino = normalizarTextoMenu(
                            (elemento.getAttribute("href") || "") + " " +
                            (elemento.getAttribute("onclick") || "")
                        );
                        return texto === "CNS" ||
                            texto === "CONSULTA CNS" ||
                            texto.startsWith("CNS ") ||
                            /(?:^|[^A-Z])CNS(?:[^A-Z]|$)/.test(destino);
                    }) || null;

                    if (!opcaoCNS) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }

                if (!opcaoCNS) {
                    throw new Error("Abri CONSULTA AMB, mas não encontrei a opção CNS dentro desse menu.");
                }

                await chrome.runtime.sendMessage({ type: "CONSULTA_CNS_NAVEGACAO_INICIADA" });
                opcaoCNS.click();

                campo = await aguardarElementoSISREG(
                    'input[name="nu_cns"]',
                    20000,
                    "Abri CONSULTA AMB > CNS, mas o campo input[name='nu_cns'] não apareceu. Verifique se a opção CNS abriu no frame correto."
                );
            }

            const docConsulta = campo.ownerDocument;
            campo.focus();
            campo.value = String(numero || "").replace(/\D/g, "");
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            campo.dispatchEvent(new Event("change", { bubbles: true }));

            const botaoPesquisar = docConsulta.querySelector('input[name="btn_pesquisar"]');
            if (!botaoPesquisar) {
                throw new Error("Encontrei o campo nu_cns, mas não encontrei input[name='btn_pesquisar'] na mesma tela.");
            }

            await chrome.runtime.sendMessage({ type: "CONSULTA_CNS_PESQUISA_ENVIADA" });
            botaoPesquisar.click();

            // Aguarda resultado por AJAX. Se a pesquisa recarregar a página,
            // background.js enviará CAPTURAR_RESULTADO_CNS após o carregamento.
            const inicio = Date.now();
            const timer = setInterval(function () {
                const docResultado = localizarDocumentoResultado();
                if (docResultado) {
                    clearInterval(timer);
                    processarResultadoInicial(docResultado);
                    return;
                }

                if (Date.now() - inicio >= 25000) {
                    clearInterval(timer);
                    const texto = docConsulta.body ? docConsulta.body.innerText.trim().slice(0, 500) : "";
                    chrome.runtime.sendMessage({
                        type: "CONSULTA_CNS_ERRO",
                        mensagem: texto
                            ? "O botão Pesquisar foi acionado, mas o resultado do CADWEB não apareceu. Trecho da tela: " + texto
                            : "O botão Pesquisar foi acionado, mas o SISREG não apresentou o resultado dentro do tempo esperado."
                    });
                }
            }, 500);
        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_ERRO",
                mensagem: erro.message || "Falha durante a consulta CNS."
            });
        }
    }


    async function abrirFichaSolicitacaoCNS(id) {
        const numero = String(id || "").replace(/\D/g, "");
        const inicio = Date.now();
        let linha = null;
        while (!linha && Date.now() - inicio < 12000) {
            linha = percorrerDocumentos(function (doc) {
                return Array.from(doc.querySelectorAll("tr.linha_selecionavel")).find(function (tr) {
                    const match = (tr.getAttribute("onclick") || "").match(/visualizaFicha\s*\(\s*['"]?(\d+)/i);
                    return match && match[1] === numero;
                }) || null;
            });
            if (!linha) await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!linha) {
            chrome.runtime.sendMessage({type:"FICHA_CNS_ERRO",id:numero,mensagem:"Não encontrei essa solicitação na tabela do SISREG. Faça novamente a consulta por CNS/CPF."});
            return;
        }
        // Guarda as fichas que já estavam no DOM antes do clique.
        // Ao voltar à tabela, o SISREG pode manter a ficha anterior oculta;
        // sem esta comparação, a busca pode capturar novamente o registro antigo.
        const fichasAnteriores = new Map();
        percorrerDocumentos(function (doc) {
            Array.from(doc.querySelectorAll("table.table_listagem")).forEach(function (tabela) {
                const texto = normalizarTextoMenu(tabela.innerText || tabela.textContent || "");
                if (texto.includes("CHAVE DE CONFIRMACAO") ||
                    (texto.includes("DADOS DO PACIENTE") && texto.includes("DADOS DA SOLICITACAO"))) {
                    fichasAnteriores.set(tabela, tabela.outerHTML);
                }
            });
            return null;
        });

        linha.click();

        const inicioFicha = Date.now();
        let tabelaFicha = null;
        let htmlCandidato = "";
        let estabilidadeDesde = 0;

        while (Date.now() - inicioFicha < 18000) {
            const candidata = percorrerDocumentos(function (doc) {
                return Array.from(doc.querySelectorAll("table.table_listagem")).find(function (tabela) {
                    const texto = normalizarTextoMenu(tabela.innerText || tabela.textContent || "");
                    const pareceFicha = texto.includes("CHAVE DE CONFIRMACAO") ||
                        (texto.includes("DADOS DO PACIENTE") && texto.includes("DADOS DA SOLICITACAO"));
                    if (!pareceFicha) return false;

                    // Só aceita uma ficha criada agora ou cujo conteúdo mudou
                    // depois do clique na solicitação selecionada.
                    return !fichasAnteriores.has(tabela) ||
                        fichasAnteriores.get(tabela) !== tabela.outerHTML;
                }) || null;
            });

            if (candidata) {
                const htmlAtual = candidata.outerHTML;
                if (candidata !== tabelaFicha || htmlAtual !== htmlCandidato) {
                    tabelaFicha = candidata;
                    htmlCandidato = htmlAtual;
                    estabilidadeDesde = Date.now();
                } else if (Date.now() - estabilidadeDesde >= 500) {
                    break;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        if (!tabelaFicha || Date.now() - estabilidadeDesde < 500) {
            chrome.runtime.sendMessage({type:"FICHA_CNS_ERRO",id:numero,mensagem:"O SISREG não apresentou uma ficha nova para esta solicitação. Volte à tabela e tente novamente; se persistir, atualize a consulta por CNS/CPF."});
            return;
        }
        // Captura a ficha inteira, incluindo o título/rodapé da área original.
        const fichaOriginal = tabelaFicha.closest("#fichaAmbulatorial") || tabelaFicha;
        const copiaFicha = fichaOriginal.cloneNode(true);
        const originais = [fichaOriginal, ...Array.from(fichaOriginal.querySelectorAll("*"))];
        const copias = [copiaFicha, ...Array.from(copiaFicha.querySelectorAll("*"))];
        originais.forEach(function (original, indice) {
            const copia = copias[indice];
            if (!copia) return;
            try {
                const estilo = original.ownerDocument.defaultView.getComputedStyle(original);
                const declaracoes = [];
                for (let i = 0; i < estilo.length; i++) {
                    const propriedade = estilo[i];
                    declaracoes.push(propriedade + ":" + estilo.getPropertyValue(propriedade));
                }
                copia.setAttribute("style", declaracoes.join(";"));
            } catch (erro) {}
            Array.from(copia.attributes || []).forEach(function (atributo) {
                if (/^on/i.test(atributo.name)) copia.removeAttribute(atributo.name);
            });
            if (copia.tagName === "IMG") {
                const origem = original.getAttribute("src");
                if (origem) copia.setAttribute("src", new URL(origem, original.ownerDocument.location.href).href);
            }
        });
        copiaFicha.querySelectorAll("script,iframe,object,embed").forEach(function (elemento) { elemento.remove(); });
        chrome.runtime.sendMessage({type:"FICHA_CNS_CAPTURADA",id:numero,html:copiaFicha.outerHTML});
    }

    chrome.runtime.onMessage.addListener(function (message) {
        if (message.type === "EXECUTAR_CONSULTA_CNS") {
            consultaCNSResultadoEnviado = false;
            executarConsultaCNS(message.numero);
            return;
        }
        if (message.type === "ABRIR_FICHA_CNS") {
            abrirFichaSolicitacaoCNS(message.id);
            return;
        }
        if (message.type === "RETORNAR_SOLICITACOES_CNS") {
            resultadoCNSProcessado = true;
            preenchimentoSolicitacoesEmAndamento = false;
            abrirSolicitacoesEPreencher(message.cns, message.jsonData || {});
            return;
        }

        if (message.type === "CAPTURAR_RESULTADO_CNS") {
            const docResultado = localizarDocumentoResultado();
            if (docResultado) {
                processarResultadoInicial(docResultado);
            } else {
                chrome.runtime.sendMessage({
                    type: "CONSULTA_CNS_ERRO",
                    mensagem: "A página terminou de carregar, mas não encontrei o resultado da pesquisa inicial do CADWEB."
                });
            }
            return;
        }

        if (message.type === "PREENCHER_CNS_SOLICITACOES") {
            resultadoCNSProcessado = true;
            concluirPreenchimentoSolicitacoes(message.cns);
            return;
        }
    });

    /*
    -----------------------------------------------------
    EXPORTAÇÃO DO ARQUIVO CSV
    -----------------------------------------------------
    */
    chrome.runtime.onMessage.addListener(async function (message) {
        if (message.type !== "EXECUTAR_EXPORTACAO_CSV") return;

        try {
            const dados = new URLSearchParams();
            dados.append("data1", message.dataInicial);
            dados.append("data2", message.dataFinal);
            dados.append("cpf", "0");
            dados.append("procedimento", "0");
            dados.append("tp_arquivo", "1");
            dados.append("etapa", "exportar");
            dados.append("unidade", "2399318");

            const resposta = await fetch("https://sisregiii.saude.gov.br/cgi-bin/expo_solicitacoes", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: dados.toString()
            });

            const sessaoEncerrada = await verificarRespostaSISREG(resposta);
            if (sessaoEncerrada) {
                throw new Error("Sua sessão do SISREG foi encerrada. Faça login novamente.");
            }
            if (!resposta.ok) {
                throw new Error("O SISREG retornou erro HTTP " + resposta.status);
            }

            const blob = await resposta.blob();
            if (blob.size === 0) {
                throw new Error("O SISREG retornou um arquivo vazio.");
            }

            // Gerar Nome no padrão: agenda_sisreg_YYYYMMDD.csv
            const agora = new Date();
            const ano = agora.getFullYear();
            const mes = String(agora.getMonth() + 1).padStart(2, "0");
            const dia = String(agora.getDate()).padStart(2, "0");
            const nomeArquivo = `agenda_sisreg_${ano}${mes}${dia}.csv`;

            // Converte o arquivo para enviar ao background e fazer download com substituição
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = function () {
                chrome.runtime.sendMessage({
                    type: "EFETUAR_DOWNLOAD_SUBSTITUIR",
                    dataUrl: reader.result,
                    nomeArquivo: nomeArquivo
                });
            };

        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "EXPORTACAO_ERRO",
                mensagem: "Não foi possível exportar o CSV: " + erro.message
            });
        }
    });
}
