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
            jsonData: message.jsonData
        }, "*");
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

    async function concluirPreenchimentoSolicitacoes(cns) {
        if (preenchimentoSolicitacoesEmAndamento) return;
        preenchimentoSolicitacoesEmAndamento = true;

        try {
            const campoCNS = await aguardarElementoSISREG(
                'input[name="cns_paciente"]',
                25000,
                "A página de Solicitações Ambulatoriais foi aberta, mas o campo input[name='cns_paciente'] não apareceu em até 25 segundos."
            );

            await chrome.runtime.sendMessage({ type: "CONSULTA_CNS_SOLICITACOES_PRONTA" });
            preencherCampoComEventos(campoCNS, cns);

            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_PREENCHIMENTO_CONCLUIDO"
            });
        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_ERRO",
                mensagem: erro.message || "Não foi possível preencher o CNS na tela de Solicitações Ambulatoriais."
            });
        }
    }

    async function abrirSolicitacoesEPreencher(cns, dadosResultado) {
        try {
            // Guarda o resultado e prepara o background para eventual navegação/reload.
            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_RESULTADO_CAPTURADO",
                cns: cns,
                jsonData: dadosResultado
            });

            // A pesquisa inicial já abriu a área CONSULTA AMB (a mesma que contém CNS).
            // Portanto, não clicamos novamente no menu superior: procuramos diretamente
            // a opção SOLICITAÇÕES, que fica na mesma área de navegação.
            const opcaoSolicitacoes = await aguardarOpcaoMenuSISREG("solicitacoes", 20000);

            await chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_NAVEGACAO_SOLICITACOES_INICIADA"
            });

            opcaoSolicitacoes.click();

            // Se a navegação for interna/AJAX, o campo será encontrado neste mesmo documento.
            // Se houver recarregamento completo, background.js retomará o preenchimento.
            await concluirPreenchimentoSolicitacoes(cns);
        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "CONSULTA_CNS_ERRO",
                mensagem: erro.message || "Não foi possível abrir CONSULTA AMB > SOLICITAÇÕES."
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

            // Primeira etapa: abrir a opção CNS para pesquisar o CPF ou CNS informado.
            if (!campo) {
                const opcaoCNS = percorrerDocumentos(function (doc) {
                    const opcoes = Array.from(doc.querySelectorAll("a, button, input[type='button'], input[type='submit']"));
                    return opcoes.find(function (elemento) {
                        const texto = (elemento.innerText || elemento.value || elemento.getAttribute("title") || "").trim();
                        const alvo = (elemento.getAttribute("href") || "") + " " + (elemento.getAttribute("onclick") || "");
                        return /\bCNS\b/i.test(texto) || /cns/i.test(alvo);
                    });
                });

                if (!opcaoCNS) {
                    throw new Error("Não localizei a opção CNS no menu do SISREG, nem na página principal nem nos frames.");
                }

                await chrome.runtime.sendMessage({ type: "CONSULTA_CNS_NAVEGACAO_INICIADA" });
                opcaoCNS.click();
                campo = await aguardarElementoSISREG(
                    'input[name="nu_cns"]',
                    20000,
                    "Não encontrei input[name='nu_cns'] após abrir a opção CNS."
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

    chrome.runtime.onMessage.addListener(function (message) {
        if (message.type === "EXECUTAR_CONSULTA_CNS") {
            consultaCNSResultadoEnviado = false;
            executarConsultaCNS(message.numero);
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
