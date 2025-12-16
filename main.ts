import {
	App,
	DropdownComponent,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

// obsidian-nmap-plugin.js

const xml2js = require("xml2js"); // Use xml2js to parse XML

// Remember to rename these classes and interfaces!

interface NmapSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: NmapSettings = {
	mySetting: "default",
};

// Main Plugin
export default class Nmap extends Plugin {
	settings: NmapSettings;

	async onload() {
		await this.loadSettings();

		// ##############################################    Ribbon    ########################################################""
		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"radar",
			"Nmaper",
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				new NmapModal(this.app).open();
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// ##############################################  Status Bar  ########################################################""
		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Nmaper ready");

		// ##############################################   Commands   ########################################################""
		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "nmaper",
			name: "Import Nmap XML scan report",
			callback: () => {
				new NmapModal(this.app).open();
			},
		});

		// ############################################## Settings Tabs ######################################################""
		// This adds a settings tab so the user can configure various aspects of the plugin
		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		//this.registerDomEvent(document, "click", (evt: MouseEvent) => {
		//	console.log("click", evt);
		//});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		//this.registerInterval(
		//window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		//);
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Modal
class NmapModal extends Modal {
	private xmlFileContent: any;
	private outputDirectory: any;

	constructor(app: App) {
		super(app);
		this.outputDirectory = null;
		this.xmlFileContent = null;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Parse Nmap report file" });
		const main = contentEl.createDiv({ cls: "setting-item" });

		// Section Title Div
		const sectionTitleDiv = main.createDiv({
			cls: "setting-item-info-div",
		});
		sectionTitleDiv.createEl("span", {
			text: "XML File",
			cls: "setting-item-name",
		});
		sectionTitleDiv.createEl("span", {
			text: "Select Nmap XML output file",
			cls: "setting-item-description",
		});

		// Create the hidden file input element
		const fileInput = main.createEl("input", {
			type: "file",
			cls: "file-input-hidden",
			attr: { id: "file-input" },
		});

		// Create the label element that will act as the styled button
		main.createEl("label", {
			text: "Choose File",
			cls: "file-input-label",
			attr: { for: "file-input" },
		});

		// Create a span to display the selected file name
		const fileNameSpan = main.createEl("span", {
			text: "No file chosen",
			cls: "file-name-display",
		});

		// Add an event listener to update the fileNameSpan when a file is selected
		fileInput.addEventListener("change", async (event: Event) => {
			const target = event.target as HTMLInputElement;
			const file = target.files?.[0];
			if (file) {
				fileNameSpan.textContent = file.name;
				this.xmlFileContent = await file.text();
				// Proceed with further processing, e.g., this.parseNmapXML();
			} else {
				fileNameSpan.textContent = "No file chosen";
			}
		});

		new Setting(contentEl)

			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			)
			.addButton((btn) =>
				btn
					.setCta()
					.setButtonText("Continue")
					.onClick(() => {
						if (this.xmlFileContent == null) {
							new Notice("No XML file selected !");
							return;
						}

						this.parseNmapXML();
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	async parseNmapXML() {
		try {
			const result = await xml2js.parseStringPromise(this.xmlFileContent);
			const hosts = result?.nmaprun?.host || [];

			const targetFolder = await this.getUserSelectedFolder();
			let canvasFile = await this.createOrGetCanvas(targetFolder);

			// Read canvas data once
			const canvasContent = await this.app.vault.read(canvasFile);
			const canvasData = JSON.parse(canvasContent);
			canvasData.nodes = canvasData.nodes || [];

			const fileCreationPromises = [];
			const newNodes: any[] = [];

			for (const host of hosts) {
				const hostname =
					host?.hostnames?.[0]?.hostname?.[0]?.$.name || "Unknown";
				const ipAddress = host?.address?.[0]?.$.addr || "Unknown";

				const pageContent = this.createPageContent(host);

				const fileName = `${ipAddress}.md`;
				const filePath = targetFolder
					? `${targetFolder}/${fileName}`
					: fileName;

				// Prepare file creation promise
				fileCreationPromises.push(
					this.app.vault.create(filePath, pageContent).then((createdFile) => {
						// Prepare canvas node
						const fileId = `file-${createdFile.path}`;
						newNodes.push({
							id: fileId,
							type: "file",
							file: createdFile.path,
							width: 475,
							height: 500,
							x: Math.random() * 900, // Random X coordinate
							y: Math.random() * 1000, // Random Y coordinate
						});
					})
				);
			}

			// Wait for all files to be created
			await Promise.all(fileCreationPromises);

			// Append all new nodes and write canvas file once
			canvasData.nodes.push(...newNodes);
			await this.app.vault.modify(
				canvasFile,
				JSON.stringify(canvasData, null, 2)
			);

			new Notice("Nmap XML processed successfully!");
		} catch (err) {
			console.error("Error parsing Nmap XML:", err);
			new Notice("Error processing the XML file.");
		}
	}

	async createOrGetCanvas(folder: any): Promise<TFile> {
		const canvasName = "network.canvas";
		const canvasPath = folder ? `${folder}/${canvasName}` : canvasName;

		let canvasFile = this.app.vault.getAbstractFileByPath(canvasPath);

		if (!canvasFile) {
			canvasFile = await this.app.vault.create(canvasPath, "{}");
		}

		if (!(canvasFile instanceof TFile)) {
			throw new Error(`${canvasPath} is not a file`);
		}

		return canvasFile;
	}

	async getUserSelectedFolder() {
		// Open a modal to allow users to choose a folder or use the cursor location
		const folders = this.app.vault.getAllFolders();

		const currentFolder = this.app.fileManager.getNewFileParent("").path;

		return new Promise((resolve, reject) => {
			const modal = new Modal(this.app);
			const { contentEl } = modal;

			contentEl.createEl("h2", { text: "Select XML file to parse" });

			// Create ComboBox
			new Setting(contentEl)
				.setName("Output folder")
				.setDesc("Select Obsidian folder")
				.addDropdown((component: DropdownComponent) => {
					const map = {} as Record<string, string>;

					for (const folder of folders) {
						map[folder.path] = folder.path;
					}
					component.addOptions(map);
					component.onChange((value) => {
						this.outputDirectory = value;
					});
				});

			new Setting(contentEl)
				.addButton((btn) => {
					btn.setButtonText("Cancel").onClick(() => {
						reject(null);
						modal.close();
					});
				})
				.addButton((btn) =>
					btn
						.setButtonText("Submit")
						.setCta()
						.onClick(() => {
							// Normalizing input now so I don't gotta do it later
							resolve(this.outputDirectory);
							modal.close();
						})
				);

			modal.open();
		});
	}

	createPageContent(host: any) {
		const ports = host?.ports?.[0]?.port || [];

		let content = "\n---\n\n";

		if (ports.length > 0) {
			content += "## Open Ports And Services\n\n";
			content += "| Port | Protocol | Service | State |\n";
			content += "|------|----------|---------|-------|\n";

			for (const port of ports) {
				const portId = port?.$.portid || "Unknown";
				const protocol = port?.$.protocol || "Unknown";
				const service = port?.service?.[0]?.$.name || "Unknown";
				const state = port?.state?.[0]?.$.state || "Unknown";

				content += `| ${portId} | ${protocol} | ${service} | ${state} |\n`;
			}
		} else {
			content += "No open ports were found.\n";
		}

		content += "## Vulnerabilities Discovered";

		return content;
	}
}

// Setting tab
class NmapSettingsTab extends PluginSettingTab {
	plugin: Nmap;

	constructor(app: App, plugin: Nmap) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
