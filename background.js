console.log("BACKGROUND SISREG INICIADO");

let abaNossaPagina = null;
let abaSISREG = null;

chrome.runtime.onMessage.addListener(async function (message, sender) {

    /*
    =================================================
    NOVA OPERAÇÃO: CONSULTA POR CNS / CPF
    =================================================
    */
    if (message.type === "CONSULTAR_DADOS_CNS") {
        if (sender.tab) abaNossaPagina = sender.tab.id;
        const numero = String(message.numero || "").replace(/\\D/g, "");
        if (numero.length !== 11 && numero.length !== 15) {
            if (abaNossaPagina) {
                try {
                    await chrome.tabs.sendMessage(abaNossaPagina, {
                        type: "CONSULTA_CNS_ERRO",
                        mensagem: "Informe um CNS com 15 dígitos ou CPF com 11 dígitos."
                    });
                } catch (e) {}
            }
            return;
        }

        await chrome.storage.session.set({
            operacaoAtual: "consultar_cns",
            consultaCNS: { numero: numero },
            consultaCNSIniciada: false,
            consultaCNSAguardandoNavegacao: false,
            consultaCNSAguardandoResultado: false,
            abaNossaPagina: abaNossaPagina
        });

        const tab = await chrome.tabs.create({
            url: "https://sisregiii.saude.gov.br/cgi-bin/index",
            active: false
        });
        abaSISREG = tab.id;
        await chrome.storage.session.set({ abaSISREG: tab.id });
        return;
    }


    /*
    =================================================
    SOLICITAÇÃO DE LOGIN
    =================================================
    */
    if (message.type === "INICIAR_LOGIN_SISREG") {
        if (sender.tab) abaNossaPagina = sender.tab.id;

        await chrome.storage.session.set({
            loginSISREG: { username: message.username, password: message.password },
            operacaoAtual: "login",
            tentativaEnviada: false,
            abaNossaPagina: abaNossaPagina
        });

        const tab = await chrome.tabs.create({
            url: "https://sisregiii.saude.gov.br/cgi-bin/index",
            active: false
        });

        abaSISREG = tab.id;
        await chrome.storage.session.set({ abaSISREG: tab.id });
        return;
    }

    /*
    =================================================
    SOLICITAÇÃO DE EXPORTAÇÃO CSV
    =================================================
    */
    if (message.type === "EXPORTAR_CSV") {
        if (sender.tab) abaNossaPagina = sender.tab.id;

        if (!message.dataInicial || !message.dataFinal) {
            if (abaNossaPagina) {
                await chrome.tabs.sendMessage(abaNossaPagina, {
                    type: "EXPORTACAO_ERRO",
                    mensagem: "Informe a data inicial e a data final."
                });
            }
            return;
        }

        await chrome.storage.session.set({
            operacaoAtual: "exportar_csv",
            exportacaoCSV: { dataInicial: message.dataInicial, dataFinal: message.dataFinal },
            exportacaoIniciada: false,
            abaNossaPagina: abaNossaPagina
        });

        const tab = await chrome.tabs.create({
            url: "https://sisregiii.saude.gov.br/cgi-bin/index",
            active: false
        });

        abaSISREG = tab.id;
        await chrome.storage.session.set({ abaSISREG: tab.id });
        return;
    }

    /*
    =================================================
    ACOMPANHAMENTO DO ESTADO DO SISREG
    =================================================
    */
    if (message.type === "SISREG_ESTADO") {
        const tabId = sender.tab?.id;
        if (!tabId) return;

        const dados = await chrome.storage.session.get([
            "loginSISREG", "abaSISREG", "abaNossaPagina", "operacaoAtual", "exportacaoCSV", "exportacaoIniciada", "tentativaEnviada", "consultaCNS", "consultaCNSIniciada", "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado"
        ]);

        if (dados.abaSISREG !== tabId) return;


        /*
        ---------------------------------------------
        OPERAÇÃO: CONSULTA CNS / CPF
        ---------------------------------------------
        */
        if (dados.operacaoAtual === "consultar_cns") {
            if (message.telaLogin === true) {
                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                            type: "CONSULTA_CNS_ERRO",
                            mensagem: "Sessão do SISREG não autenticada. Faça login novamente e tente a consulta."
                        });
                    } catch (e) {}
                }
                await chrome.storage.session.set({ operacaoAtual: null });
                await chrome.storage.session.remove(["consultaCNS", "consultaCNSIniciada", "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado"]);
                setTimeout(async () => { try { await chrome.tabs.remove(tabId); } catch (e) {} }, 500);
                return;
            }

            if (message.telaLogin === false) {
                if (!dados.consultaCNSIniciada) {
                    await chrome.storage.session.set({ consultaCNSIniciada: true });
                    try {
                        await chrome.tabs.sendMessage(tabId, {
                            type: "EXECUTAR_CONSULTA_CNS",
                            numero: dados.consultaCNS?.numero
                        });
                    } catch (e) {}
                }
                return;
            }
        }

        /*
        ---------------------------------------------
        OPERAÇÃO: LOGIN
        ---------------------------------------------
        */
        if (dados.operacaoAtual === "login") {

            // CASO 1: ERRO DE SENHA / LOGIN INCORRETO
            if (message.erroLogin) {
                console.log("LOGIN INCORRETO DETECTADO.");

                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                            type: "LOGIN_SISREG_ERRO",
                            mensagem: "Login ou senha incorreto(s). Verifique suas credenciais."
                        });
                    } catch (e) {}
                }

                await chrome.storage.session.set({ operacaoAtual: null });
                await chrome.storage.session.remove(["loginSISREG", "abaSISREG", "tentativaEnviada"]);

                setTimeout(async () => {
                    try { await chrome.tabs.remove(tabId); } catch (e) {}
                }, 500);

                return;
            }

            // CASO 2: TELA DE LOGIN (PREENCHER UMA ÚNICA VEZ)
            if (message.telaLogin === true) {
                if (dados.tentativaEnviada) return; // Evita loop infinito de envio

                const login = dados.loginSISREG;
                if (!login) return;

                await chrome.storage.session.set({ tentativaEnviada: true });

                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: "PREENCHER_LOGIN",
                        username: login.username,
                        password: login.password
                    });
                } catch (erro) {}

                return;
            }

            // CASO 3: LOGADO COM SUCESSO
            if (message.telaLogin === false) {
                await chrome.storage.session.set({ operacaoAtual: null });
                await chrome.storage.session.remove(["loginSISREG", "abaSISREG", "tentativaEnviada"]);

                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, { type: "LOGIN_SISREG_SUCESSO" });
                    } catch (e) {}
                }

                setTimeout(async () => {
                    try { await chrome.tabs.remove(tabId); } catch (e) {}
                }, 700);

                return;
            }
        }

        /*
        ---------------------------------------------
        OPERAÇÃO: EXPORTAÇÃO CSV
        ---------------------------------------------
        */
        if (dados.operacaoAtual === "exportar_csv") {
            if (message.telaLogin === true) {
                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                            type: "EXPORTACAO_ERRO",
                            mensagem: "Sessão expirada. Faça login novamente."
                        });
                    } catch (e) {}
                }

                await chrome.storage.session.set({ operacaoAtual: null });
                setTimeout(async () => { try { await chrome.tabs.remove(tabId); } catch (e) {} }, 500);
                return;
            }

            if (message.telaLogin === false) {
                const exportacao = dados.exportacaoCSV;
                if (!exportacao) return;

                // O SISREG pode informar "telaLogin=false" mais de uma vez
                // durante o carregamento. A exportação deve ser executada apenas uma vez.
                if (dados.exportacaoIniciada) return;

                await chrome.storage.session.set({
                    exportacaoIniciada: true
                });

                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: "EXECUTAR_EXPORTACAO_CSV",
                        dataInicial: exportacao.dataInicial,
                        dataFinal: exportacao.dataFinal
                    });
                } catch (e) {}
                return;
            }
        }
    }


    if (message.type === "CONSULTA_CNS_NAVEGACAO_INICIADA") {
        await chrome.storage.session.set({ consultaCNSAguardandoNavegacao: true });
        return;
    }

    if (message.type === "CONSULTA_CNS_PESQUISA_ENVIADA") {
        await chrome.storage.session.set({
            consultaCNSAguardandoNavegacao: false,
            consultaCNSAguardandoResultado: true
        });
        return;
    }

    if (message.type === "DADOS_CNS_SUCESSO" || message.type === "CONSULTA_CNS_ERRO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);
        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: message.type,
                    jsonData: message.jsonData,
                    mensagem: message.mensagem
                });
            } catch (e) {}
        }
        await chrome.storage.session.set({ operacaoAtual: null });
        await chrome.storage.session.remove(["consultaCNS", "consultaCNSIniciada", "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado"]);
        if (dados.abaSISREG) {
            setTimeout(async () => { try { await chrome.tabs.remove(dados.abaSISREG); } catch (e) {} }, 900);
        }
        return;
    }

    /*
    =================================================
    DOWNLOAD E SUBSTITUIÇÃO DO CSV
    =================================================
    */
    if (message.type === "EFETUAR_DOWNLOAD_SUBSTITUIR") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);

        if (!dados.abaNossaPagina) return;

        try {
            await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                type: "ARQUIVO_CSV_PRONTO",
                dataUrl: message.dataUrl,
                nomeArquivo: message.nomeArquivo
            });
        } catch (e) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "EXPORTACAO_ERRO",
                    mensagem: "Não foi possível enviar o CSV para a página de gravação: " + e.message
                });
            } catch (erro) {}
        }

        return;
    }

    /*
    =================================================
    CONFIRMAÇÃO DE GRAVAÇÃO DIRETA NA PASTA
    =================================================
    */
    if (message.type === "ARQUIVO_SALVO_DIRETO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);

        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "EXPORTACAO_SUCESSO",
                    mensagem: "CSV salvo diretamente na pasta SISREG3 (" + message.nomeArquivo + ")"
                });
            } catch (e) {}
        }

        await chrome.storage.session.set({ operacaoAtual: null });
        await chrome.storage.session.remove(["exportacaoCSV", "exportacaoIniciada"]);

        if (dados.abaSISREG) {
            setTimeout(async () => {
                try { await chrome.tabs.remove(dados.abaSISREG); } catch (e) {}
            }, 1000);
        }

        return;
    }

    if (message.type === "ERRO_SALVAR_ARQUIVO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);

        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "EXPORTACAO_ERRO",
                    mensagem: "Erro ao gravar o CSV na pasta: " + message.mensagem
                });
            } catch (e) {}
        }

        await chrome.storage.session.set({ operacaoAtual: null });
        await chrome.storage.session.remove(["exportacaoCSV", "exportacaoIniciada"]);

        if (dados.abaSISREG) {
            setTimeout(async () => {
                try { await chrome.tabs.remove(dados.abaSISREG); } catch (e) {}
            }, 500);
        }

        return;
    }

    /*
    =================================================
    TRATAMENTO DE ERRO DE EXPORTAÇÃO
    =================================================
    */
    if (message.type === "EXPORTACAO_ERRO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);

        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "EXPORTACAO_ERRO",
                    mensagem: message.mensagem
                });
            } catch (e) {}
        }

        await chrome.storage.session.set({ operacaoAtual: null });
        await chrome.storage.session.remove("exportacaoCSV");

        if (dados.abaSISREG) {
            setTimeout(async () => {
                try { await chrome.tabs.remove(dados.abaSISREG); } catch (e) {}
            }, 500);
        }
        return;
    }
});


/*
=========================================================
CONTINUIDADE DA CONSULTA CNS APÓS NAVEGAÇÃO DO SISREG
=========================================================
*/
chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo) {
    if (changeInfo.status !== "complete") return;

    const dados = await chrome.storage.session.get([
        "abaSISREG", "operacaoAtual", "consultaCNS",
        "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado"
    ]);
    if (dados.abaSISREG !== tabId || dados.operacaoAtual !== "consultar_cns") return;

    if (dados.consultaCNSAguardandoNavegacao) {
        await chrome.storage.session.set({ consultaCNSAguardandoNavegacao: false, consultaCNSIniciada: true });
        try {
            await chrome.tabs.sendMessage(tabId, {
                type: "EXECUTAR_CONSULTA_CNS",
                numero: dados.consultaCNS?.numero
            });
        } catch (e) {}
        return;
    }

    if (dados.consultaCNSAguardandoResultado) {
        await chrome.storage.session.set({ consultaCNSAguardandoResultado: false });
        try {
            await chrome.tabs.sendMessage(tabId, { type: "CAPTURAR_RESULTADO_CNS" });
        } catch (e) {}
    }
});
