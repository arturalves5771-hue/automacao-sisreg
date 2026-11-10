async function tratarSessaoExpiradaSISREG(tabId, mensagem) {
    if (!tabId || tabId < 0) return;
    const dados = await chrome.storage.session.get(["abaSISREG", "abaNossaPagina", "sessaoExpiradaNotificada"]);
    if ((dados.abaSISREG && dados.abaSISREG !== tabId) || dados.sessaoExpiradaNotificada) return;

    await chrome.storage.session.set({ sessaoExpiradaNotificada: true, operacaoAtual: null });
    await chrome.storage.session.remove([
        "loginSISREG", "tentativaEnviada", "consultaCNS", "consultaCNSIniciada",
        "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado",
        "consultaCNSConsultas", "consultaEtapa", "exportacaoCSV", "exportacaoIniciada"
    ]);

    if (dados.abaNossaPagina) {
        try {
            await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                type: "SISREG_SESSAO_EXPIRADA",
                mensagem: mensagem || "O SISREG encerrou sua sessão porque houve um novo acesso em outra estação. Entre novamente."
            });
        } catch (erro) {
            console.warn("Não foi possível avisar a tela da Automação SISREG:", erro);
        }
    }
}

chrome.webRequest.onCompleted.addListener(function (details) {
    if ([401, 403, 419, 440].includes(details.statusCode)) {
        tratarSessaoExpiradaSISREG(
            details.tabId,
            "O SISREG recusou uma requisição (HTTP " + details.statusCode + "). Sua sessão pode ter sido encerrada. Entre novamente."
        );
    }
}, { urls: ["https://sisregiii.saude.gov.br/*"] });

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
        const numero = String(message.numero || "").replace(/\D/g, "");
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
            consultaCNSResultado: null,
            consultaCNSNumeroEncontrado: null,
            consultaCNSConsultas: [],
            consultaEtapa: "cadweb",
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
            sessaoExpiradaNotificada: false,
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
    if (message.type === "SISREG_SESSAO_EXPIRADA") {
        await tratarSessaoExpiradaSISREG(
            sender.tab?.id,
            message.mensagem || "O SISREG encerrou sua sessão. Entre novamente."
        );
        return;
    }

    if (message.type === "SISREG_ESTADO") {
        const tabId = sender.tab?.id;
        if (!tabId) return;

        const dados = await chrome.storage.session.get([
            "loginSISREG", "abaSISREG", "abaNossaPagina", "operacaoAtual", "exportacaoCSV", "exportacaoIniciada", "tentativaEnviada", "consultaCNS", "consultaCNSIniciada", "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado", "consultaEtapa"
        ]);

        if (dados.abaSISREG !== tabId) return;


        /*
        ---------------------------------------------
        OPERAÇÃO: CONSULTA CNS / CPF
        ---------------------------------------------
        */
        if (dados.operacaoAtual === "consultar_cns" && dados.consultaEtapa === "cadweb") {
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
                await chrome.storage.session.remove([
            "consultaCNS", "consultaCNSIniciada", "consultaCNSAguardandoNavegacao",
            "consultaCNSAguardandoResultado", "consultaCNSConsultas", "consultaEtapa"
        ]);
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

    if (message.type === "CONSULTA_CNS_RESULTADO_CAPTURADO") {
        await chrome.storage.session.set({
            consultaCNSResultado: message.jsonData,
            consultaCNSNumeroEncontrado: message.cns,
            cnsSolicitacoesAtual: message.cns,
            dadosPacienteCNSAtual: message.jsonData,
            consultaEtapa: "solicitacoes",
            consultaCNSAguardandoResultado: false
        });
        return;
    }

    if (message.type === "CONSULTA_CNS_NAVEGACAO_SOLICITACOES_INICIADA") {
        await chrome.storage.session.set({
            consultaEtapa: "solicitacoes",
            consultaCNSAguardandoNavegacao: true
        });
        return;
    }

    if (message.type === "CONSULTA_CNS_SOLICITACOES_PRONTA") {
        await chrome.storage.session.set({ consultaCNSAguardandoNavegacao: false });
        return;
    }

    if (message.type === "CONSULTA_CNS_CONSULTAS_CAPTURADAS") {
        await chrome.storage.session.set({
            consultaCNSConsultas: Array.isArray(message.consultas) ? message.consultas : []
        });
        return;
    }

    if (message.type === "RETORNAR_SOLICITACOES_CNS") {
        const dados = await chrome.storage.session.get([
            "abaSISREG", "abaNossaPagina", "cnsSolicitacoesAtual", "dadosPacienteCNSAtual"
        ]);
        if (!dados.abaSISREG || !dados.cnsSolicitacoesAtual) {
            if (dados.abaNossaPagina) {
                try {
                    await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                        type: "DADOS_CNS_FICHA_ERRO",
                        mensagem: "Não consegui recuperar o CNS desta consulta. Faça uma nova pesquisa."
                    });
                } catch (erro) {}
            }
            return;
        }
        // O retorno é executado diretamente pelo content.js.
        // Não reativar "consultar_cns": o listener onUpdated poderia iniciar
        // novamente a pesquisa inicial (nu_cns) ao navegar entre as fichas.
        await chrome.storage.session.set({
            operacaoAtual: null,
            consultaEtapa: "solicitacoes",
            consultaCNSNumeroEncontrado: dados.cnsSolicitacoesAtual,
            consultaCNSAguardandoNavegacao: false,
            consultaCNSAguardandoResultado: false
        });
        try {
            await chrome.tabs.sendMessage(dados.abaSISREG, {
                type: "RETORNAR_SOLICITACOES_CNS",
                cns: dados.cnsSolicitacoesAtual,
                jsonData: dados.dadosPacienteCNSAtual || {}
            });
        } catch (erro) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "DADOS_CNS_FICHA_ERRO",
                    mensagem: "A sessão do SISREG não respondeu. Faça uma nova consulta por CNS/CPF."
                });
            } catch (falha) {}
        }
        return;
    }

    if (message.type === "ABRIR_FICHA_CNS") {
        const dados = await chrome.storage.session.get(["abaSISREG", "abaNossaPagina"]);
        if (!dados.abaSISREG || !dados.abaNossaPagina) return;
        try {
            await chrome.tabs.sendMessage(dados.abaSISREG, {type:"ABRIR_FICHA_CNS",id:String(message.id || "")});
        } catch (e) {
            try { await chrome.tabs.sendMessage(dados.abaNossaPagina,{type:"DADOS_CNS_FICHA_ERRO",mensagem:"A sessão auxiliar do SISREG não está disponível. Faça novamente a consulta."}); } catch (_) {}
        }
        return;
    }
    if (message.type === "FICHA_CNS_CAPTURADA" || message.type === "FICHA_CNS_ERRO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina"]);
        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina,{
                    type:message.type === "FICHA_CNS_CAPTURADA" ? "DADOS_CNS_FICHA" : "DADOS_CNS_FICHA_ERRO",
                    id:message.id,html:message.html || "",mensagem:message.mensagem || ""
                });
            } catch (e) {}
        }
        return;
    }

    if (message.type === "CONSULTA_CNS_PREENCHIMENTO_CONCLUIDO") {
        const dados = await chrome.storage.session.get([
            "abaNossaPagina", "abaSISREG", "consultaCNSResultado", "consultaCNSConsultas"
        ]);

        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "DADOS_CNS_SUCESSO",
                    jsonData: dados.consultaCNSResultado,
                    consultas: dados.consultaCNSConsultas || []
                });
            } catch (e) {}
        }

        // Mantém a etapa como "solicitacoes" enquanto a aba SISREG estiver aberta.
        // Assim, abrir outra ficha nunca será confundido com uma nova consulta CADWEB (nu_cns).
        await chrome.storage.session.set({
            operacaoAtual: null,
            consultaEtapa: "solicitacoes"
        });
        await chrome.storage.session.remove([
            "consultaCNS", "consultaCNSIniciada", "consultaCNSAguardandoNavegacao",
            "consultaCNSAguardandoResultado", "consultaCNSConsultas"
        ]);

        // A aba do SISREG permanece aberta em segundo plano para abrir as fichas selecionadas.
        return;
    }

    if (message.type === "DADOS_CNS_SUCESSO" || message.type === "CONSULTA_CNS_ERRO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG", "consultaEtapa"]);

        // Um erro da rotina CADWEB não pode encerrar a aba SISREG depois que a consulta
        // inicial já terminou e a aplicação está trabalhando na tabela de Solicitações.
        if (message.type === "CONSULTA_CNS_ERRO" && dados.consultaEtapa === "solicitacoes") {
            if (dados.abaNossaPagina) {
                try {
                    await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                        type: "DADOS_CNS_FICHA_ERRO",
                        mensagem: message.mensagem || "Não foi possível concluir esta ação na tela de Solicitações."
                    });
                } catch (e) {}
            }
            return;
        }

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
        "consultaCNSAguardandoNavegacao", "consultaCNSAguardandoResultado",
        "consultaEtapa", "consultaCNSNumeroEncontrado"
    ]);
    if (dados.abaSISREG !== tabId || dados.operacaoAtual !== "consultar_cns") return;

    if (dados.consultaCNSAguardandoNavegacao) {
        await chrome.storage.session.set({ consultaCNSAguardandoNavegacao: false });

        if (dados.consultaEtapa === "solicitacoes") {
            try {
                await chrome.tabs.sendMessage(tabId, {
                    type: "PREENCHER_CNS_SOLICITACOES",
                    cns: dados.consultaCNSNumeroEncontrado
                });
            } catch (e) {
                console.error("Não foi possível retomar o preenchimento do CNS em Solicitações:", e);
            }
        } else if (dados.consultaEtapa === "cadweb") {
            await chrome.storage.session.set({ consultaCNSIniciada: true });
            try {
                await chrome.tabs.sendMessage(tabId, {
                    type: "EXECUTAR_CONSULTA_CNS",
                    numero: dados.consultaCNS?.numero
                });
            } catch (e) {
                console.error("Não foi possível retomar a consulta inicial do CNS:", e);
            }
        }
        return;
    }

    if (dados.consultaCNSAguardandoResultado) {
        await chrome.storage.session.set({ consultaCNSAguardandoResultado: false });
        try {
            await chrome.tabs.sendMessage(tabId, { type: "CAPTURAR_RESULTADO_CNS" });
        } catch (e) {
            console.error("Não foi possível capturar o resultado do CADWEB:", e);
        }
    }
});
