import asyncio
import socketio
import random
import argparse
import time
import sys
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.console import Group

# Evitar o erro "Event loop is closed" ao fechar no Windows
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

RARE_NAMES = [
    "Egas", "Urraca", "Quirino", "Guiomar", "Zózimo", 
    "Cesária", "Gudesteu", "Florbela", "Hermenegildo", "Isolina", 
    "Boaventura", "Perpétua", "Torquato", "Quitéria", "Amílcar", 
    "Zeferina", "Teotónio", "Ermelinda", "Lopo", "Lucrécia"
]

bot_logs = {}
system_errors = []

def add_log(name, message):
    if name not in bot_logs:
        bot_logs[name] = []
    bot_logs[name].append(message)
    if len(bot_logs[name]) > 6:
        bot_logs[name].pop(0)

def log_error(name, message):
    t = time.strftime("%H:%M:%S")
    system_errors.append(f"[[dim]{t}[/dim]] [bold cyan]{name}[/bold cyan]: {message}")
    if len(system_errors) > 8:
        system_errors.pop(0)

def generate_ui(active_bots):
    table = Table.grid(padding=1)
    for _ in range(4):
        table.add_column()
        
    panels = []
    for bot_name in active_bots:
        lines = bot_logs.get(bot_name, ["[dim]A aguardar ligação...[/dim]"])
        content = "\n".join(lines)
        border_color = "red" if any("❌" in line or "ERRO" in line for line in lines) else "blue"
        
        panel = Panel(
            content, 
            title=f"[bold cyan]{bot_name}[/bold cyan]", 
            height=9, 
            width=38,
            border_style=border_color
        )
        panels.append(panel)
        
    rows = [panels[i:i+4] for i in range(0, len(panels), 4)]
    for row in rows:
        while len(row) < 4:
            row.append(Text("")) 
        table.add_row(*row)

    if not system_errors:
        error_content = "\n\n[dim italic center]✅ Rede estável. Sem bloqueios ou falhas detetadas até ao momento...[/dim italic center]"
    else:
        error_content = "\n".join(system_errors)
        
    error_panel = Panel(
        error_content,
        title="[bold red]⚠️ Diagnóstico da Plataforma & Bloqueios[/bold red]",
        border_style="red",
        height=10
    )
    
    return Group(table, error_panel)

class SmartGridBot:
    def __init__(self, name, url):
        self.name = name
        self.url = url
        self.sio = socketio.AsyncClient(reconnection_delay_max=3000)
        self.role = None
        self.group = None
        self.scenario = 1
        self.powered = True
        self.session_active = False
        self.appliances = ['lights', 'tv', 'ac', 'oven', 'washer', 'ev']

        bot_logs[self.name] = []
        self.setup_events()

    def log(self, msg):
        add_log(self.name, msg)
        
    def error(self, msg):
        log_error(self.name, msg)

    def setup_events(self):
        @self.sio.on('connect')
        async def on_connect():
            self.log("[green]🟢 Ligado ao servidor.[/green]")
            try:
                await self.sio.emit('register_user', {'isAdmin': False, 'name': self.name})
            except Exception as e:
                self.error(f"[red]Erro a tentar registar utilizador: {e}[/red]")

        @self.sio.on('disconnect')
        async def on_disconnect():
            self.session_active = False
            self.error("[bold red]Ligação cortada! O Servidor node.js foi abaixo?[/bold red]")

        @self.sio.on('connect_error')
        async def on_connect_error(data):
            self.error(f"[bold red]Falha ao conectar ao servidor: {data}[/bold red]")

        @self.sio.on('role_assigned')
        async def on_role_assigned(data):
            self.role = data['role']
            self.group = data['group']
            self.scenario = data['scenario']
            papel = "GESTOR" if self.role == "manager" else "CONS."
            self.log(f"[bold yellow]🏷️ {papel} (Nó {self.group})[/bold yellow]")
            self.log("[dim]A aguardar start do admin...[/dim]")

        @self.sio.on('session_started')
        async def on_session_started(data):
            self.session_active = True
            self.log("[bold green]▶ Sessão Iniciada![/bold green]")

        @self.sio.on('scenario_changed')
        async def on_scenario_changed(data):
            self.session_active = False
            self.scenario = data['id'] if isinstance(data, dict) else data
            self.log(f"🔄 Mudou para Cenário {self.scenario}")
            self.log("[dim]Pausa. A aguardar start...[/dim]")

        @self.sio.on('full_reset')
        async def on_full_reset():
            self.session_active = False
            self.log("[bold yellow]↺ Reset pelo Admin.[/bold yellow]")

        @self.sio.on('simulation_ended')
        async def on_simulation_ended(data):
            self.session_active = False
            self.log("[bold yellow]🛑 Tempo esgotado! Fim.[/bold yellow]")

        @self.sio.on('outage_event')
        async def on_outage(data):
            if self.role != 'consumer' or not self.session_active: return
            self.powered = False
            self.log(f"[red]⚡ APAGÃO ({data.get('reason')})![/red]")
            await asyncio.sleep(3)
            try:
                await self.sio.emit('call_for_help', {'group': self.group})
                self.log("📞 Pedido de ajuda enviado.")
            except Exception as e:
                self.error(f"[red]Falha no Socket emit (call_for_help): {e}[/red]")

        @self.sio.on('power_restored')
        async def on_power_restored():
            if self.role != 'consumer': return
            self.powered = True
            self.log("[green]✅ Energia reposta![/green]")

        @self.sio.on('incoming_question')
        async def on_incoming_question(data):
            if self.role != 'consumer' or not self.session_active: return
            self.log("📞 A responder ao Gestor...")
            await asyncio.sleep(2)
            try:
                await self.sio.emit('consumer_send_reply', {
                    'managerId': data['managerId'], 'answer': data['answerExpected']
                })
            except Exception as e:
                self.error(f"[red]Falha ao responder à questão do gestor: {e}[/red]")

        @self.sio.on('demand_response_event')
        async def on_dr(data):
            if self.role != 'consumer' or not self.session_active: return
            vote = 'yes' if random.random() > 0.2 else 'no'
            self.log(f"[magenta]📡 Votei DR: {vote.upper()}[/magenta]")
            await asyncio.sleep(random.uniform(1.0, 4.0))
            try:
                await self.sio.emit('vote_dr', {'vote': vote})
            except Exception as e:
                self.error(f"[red]Falha a submeter voto DR: {e}[/red]")

        @self.sio.on('quiz_question')
        async def on_quiz(data):
            if self.role != 'consumer': return
            await asyncio.sleep(random.uniform(2.0, 10.0))
            answer = random.randint(0, len(data['options'])-1)
            self.log(f"[cyan]📝 Respondi Quiz (Opção {['A','B','C','D'][answer]})[/cyan]")
            try:
                await self.sio.emit('quiz_answer', {'answer': answer})
            except Exception as e:
                self.error(f"[red]Falha a submeter resposta ao Quiz: {e}[/red]")

        @self.sio.on('new_ticket')
        async def on_new_ticket(data):
            if self.role != 'manager' or not self.session_active: return
            target_id = data['userId']
            self.log(f"[red]🎫 A diagnosticar Nó {data['group']}...[/red]")
            asyncio.create_task(self.diagnose_and_resolve(target_id))

        @self.sio.on('predictive_alert')
        async def on_predictive_alert(data):
            if self.role != 'manager' or not self.session_active: return
            self.log(f"⚠️ Reencaminhar Nó {data['overloadedGroup']} -> Nó {data['safeGroup']}")
            await asyncio.sleep(1.5)
            try:
                await self.sio.emit('reroute_power', {'from': data['overloadedGroup'], 'to': data['safeGroup']})
            except Exception as e:
                self.error(f"[red]Erro a reencaminhar carga preditiva: {e}[/red]")

    async def diagnose_and_resolve(self, target_id):
        questions = [
            ("Verificaste o disjuntor principal?", "Sim, não disparou."),
            ("Os vizinhos também estão sem luz?", "Sim, a rua toda está às escuras."),
            ("Ouviste algum estrondo lá fora?", "Não, tudo ficou em silêncio."),
            ("Eletrodomésticos pesados ligados?", "Talvez o AC e o forno...")
        ]
        try:
            for q, a in questions:
                if not self.session_active: return 
                await asyncio.sleep(random.uniform(1.5, 3.0))
                await self.sio.emit('manager_ask_question', {
                    'targetId': target_id, 'question': q, 'answer': a
                })
            
            if not self.session_active: return
            await asyncio.sleep(2)
            await self.sio.emit('resolve_issue', {'targetId': target_id})
            self.log("[green]🔧 Diagnóstico concluído![/green]")
        except asyncio.CancelledError:
            pass  # Sai limpo se houver Ctrl+C a meio de um diagnóstico
        except Exception as e:
            self.error(f"[red]Bloqueio durante o diagnóstico: {e}[/red]")

    async def start(self):
        try:
            await self.sio.connect(self.url)
            self.loop_task = asyncio.create_task(self.background_activity_loop())
            await self.sio.wait()
        except asyncio.CancelledError:
            # Desliga graciosamente do servidor ao fechar
            if self.sio.connected:
                await self.sio.disconnect()
        except Exception as e:
            self.error(f"[bold red]Falha crítica ao ligar ao servidor: {e}[/bold red]")

    async def background_activity_loop(self):
        try:
            while True:
                await asyncio.sleep(random.uniform(3.0, 10.0))
                if not self.session_active:
                    continue
                
                try:
                    if self.role == 'consumer' and self.powered:
                        app = random.choice(self.appliances)
                        await self.sio.emit('toggle_appliance', {'appliance': app})
                        self.log(f"🔌 Alternou: {app}")
                        
                        if self.scenario == 2:
                            if random.random() > 0.7:
                                val = random.randint(0, 100)
                                await self.sio.emit('update_slider', {'type': 'produce', 'value': val})
                                self.log(f"☀️ Solar: {val}%")
                            if random.random() > 0.8:
                                mode = random.choice(['charge', 'idle', 'discharge'])
                                await self.sio.emit('toggle_battery', {'mode': mode})
                                self.log(f"🔋 Bateria: {mode}")
                                
                    elif self.role == 'manager':
                        if self.scenario == 2 and random.random() > 0.7:
                            self.log("⚖️ Pediu auto-equilíbrio.")
                            await self.sio.emit('manager_auto_balance')
                            
                except Exception as e:
                    self.error(f"[red]Erro interno no bot: {e}[/red]")
        
        except asyncio.CancelledError:
            pass # Fecha o loop infinitivo graciosamente quando há Ctrl+C


def get_arguments():
    parser = argparse.ArgumentParser(description="Simulador de Bots para o Workshop Smart Grid")
    parser.add_argument('-u', '--url', type=str, help="URL do servidor Node.js")
    parser.add_argument('-b', '--bots', type=int, help="Número de bots a gerar")
    args = parser.parse_args()

    if not args.url:
        args.url = input("🔗 Insere o URL do servidor (Enter para http://localhost:3000): ").strip() or "http://localhost:3000"
    
    if not args.bots:
        bots_input = input("🤖 Insere o número de bots (Enter para 16): ").strip()
        args.bots = int(bots_input) if bots_input.isdigit() else 16

    return args.url, args.bots


async def main():
    server_url, num_bots = get_arguments()
    num_bots = max(1, min(num_bots, len(RARE_NAMES)))
    bot_names = random.sample(RARE_NAMES, num_bots)
    
    print(f"\nA preparar {num_bots} bots para conectar a {server_url}...\n")
    await asyncio.sleep(1)
    
    bots = [SmartGridBot(name, server_url) for name in bot_names]
    
    with Live(generate_ui(bot_names), refresh_per_second=4, screen=True) as live:
        async def ui_updater():
            try:
                while True:
                    live.update(generate_ui(bot_names))
                    await asyncio.sleep(0.25)
            except asyncio.CancelledError:
                pass # Sai graciosamente ao pressionar Ctrl+C
                
        ui_task = asyncio.create_task(ui_updater())
        
        try:
            await asyncio.gather(*(bot.start() for bot in bots))
        except asyncio.CancelledError:
            pass # Impede que o erro de cancelamento buble-up e manche o terminal

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # Quando fazes Ctrl+C, o terminal volta ao normal e imprime uma despedida limpa
        print("\n✅ Simulador de Bots encerrado com sucesso. Obrigado!")
        sys.exit(0)
