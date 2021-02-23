import v from 'voca'
import { str } from './str'
import { putValuesIntoArray, isNestedInstance } from './helpers'
import { defaultPropValues, readOnlyProps, dynamicProps, textProps, styleProps } from './props'


// TODO: Check for mixed values like in corner radius
// TODO: Check for properties that can't be set on instances or nodes inside instances
// TODO: walkNodes and string API could be improved
// TODO: Fix mirror hangding null in vectors
// TODO: Some issues with auto layout, grow 1. These need to be applied to children after all children have been created.
// TODO: Need to createProps for nodes nested inside instance somewhere

var fonts
var allComponents = []
var discardNodes = []

function sendToUI(msg) {
	figma.ui.postMessage(msg)
}

function findNoneGroupParent(node) {
	if (node.parent?.type === "BOOLEAN_OPERATION"
		|| node.parent?.type === "COMPONENT_SET"
		|| node.parent?.type === "GROUP") {
		return findNoneGroupParent(node.parent)
	}
	else {
		return node.parent
	}

}

// Provides a reference for the node when printed as a string
function Ref(nodes) {
	var result = []
	if (node !== null) {
		// TODO: Needs to somehow replace parent node references of selection with figma.currentPage
		// result.push(v.camelCase(node.type) + node.id.replace(/\:|\;/g, "_"))

		nodes = putValuesIntoArray(nodes)



		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i]

			// TODO: Needs to check if node exists inside selection
			// figma.currentPage.selection.some((item) => item === node)
			function nodeExistsInSel(nodes = figma.currentPage.selection) {
				for (var i = 0; i < nodes.length; i++) {
					var sourceNode = nodes[i]
					if (sourceNode.id === node.id) {
						return true
					}
					else if (sourceNode.children) {
						return nodeExistsInSel(sourceNode.children)
					}
				}
			}

			// console.log(node.name, node.id, node.type, nodeExistsInSel())

			if (node.type === "PAGE") {
				result.push('figma.currentPage')
			}
			else {
				result.push(v.camelCase(node.type) + node.id.replace(/\:|\;/g, "_"))
			}

		}

		if (result.length === 1) result = result[0]
	}


	return result

}

// A function that lets you loop through each node and their children, it provides callbacks to reference different parts of the loops life cycle, before, during, or after the loop.

function walkNodes(nodes, callback?, parent?, selection?, level?) {
	let node

	for (var i = 0; i < nodes.length; i++) {

		if (!parent) {
			selection = i
			level = 0
		}

		node = nodes[i]

		// If main component doesn't exist in document then create it
		// FIXME: This causes a mismatch with component IDs
		if (node.type === "COMPONENT" && node.parent == null) {
			node = node.clone()
			discardNodes.push(node)
		}

		let sel = selection // Index of which top level array the node lives in
		let ref = node.type?.toLowerCase() + (i + 1 + level - sel) // Trying to find a way to create a unique identifier based on where node lives in structure

		if (!parent) parent = "figma.currentPage"

		// These may not be needed now
		var obj = {
			ref,
			level, // How deep down the node lives in the array structure
			sel,
			parent
		}
		var stop = false
		if (callback.during) {
			// If boolean value of true returned from createBasic() then this sets a flag to stop iterating children in node
			stop = callback.during(node, obj)
		}


		if (node.children) {
			++level
			if (stop && nodes[i + 1]) {
				// Iterate the next node
				++i
				walkNodes([nodes[i]], callback, ref, selection, level)
			}
			else {
				walkNodes(node.children, callback, ref, selection, level)
			}

			if (callback.after) {
				callback.after(node, obj)
			}
		}


	}
}

function walkProps(node, obj?, mainComponent?) {

	var hasText;

	var string = ""

	// String to add static props to after dynamic props have been set
	var staticPropsStr = ""
	var textPropsString = ""
	var fontsString = ""

	for (const prop in node) {
		let value = node[prop]

		// Logic for when applying props to instance. Checks if they are different from mainComponent (overriden)
		var overriddenProp = true;

		if (node.type === "INSTANCE") {
			overriddenProp = JSON.stringify(node[prop]) !== JSON.stringify(mainComponent[prop])
		}

		// Logic for checking if node is child of group type node
		// var groupProp = false;

		// if (node.parent?.type === "GROUP"
		// 	|| node.parent?.type === "COMPONENT_SET"
		// 	|| node.parent?.type === "BOOLEAN_OPERATION") {
		// 	groupProp = true
		// }

		if (overriddenProp) {

			// TODO: Needs to set more props like, chars and rotation
			if (dynamicProps.includes(prop)) {

				if (obj?.resize !== false) {
					if (prop === "width") {

						// Round widths/heights less than 0.001 to 0.01 because API does not accept less than 0.01 for frames/components/component sets
						var width = node.width
						var height = node.height
						if (node.type === "FRAME" && node.width < 0.01) width = 0.01
						if (node.type === "FRAME" && node.height < 0.01) height = 0.01

						if (node.type === "FRAME" && node.width < 0.01 || node.height < 0.01) {
							string += `${Ref(node)}.resizeWithoutConstraints(${width}, ${height}) \n`
						}
						else {
							string += `${Ref(node)}.resize(${width}, ${height}) \n`
						}

					}
				}
			}

			// Text props
			if (textProps.includes(prop)) {
				textPropsString += `\t\t${Ref(node)}.${prop} = ${JSON.stringify(value)}\n`

			}

			if (prop === "characters") {
				fonts = fonts || []
				hasText = true

				if (!fonts.some((item) => JSON.stringify(item) === JSON.stringify(node.fontName))) {
					fonts.push(node.fontName)
				}

				fontsString += `${Ref(node)}.fontName = {
							family: ${JSON.stringify(node.fontName.family)},
							style: ${JSON.stringify(node.fontName.style)}
						}`
			}

			// If prop is not readonly value and prop does not equal default
			if (
				!(value === "") &&
				!(JSON.stringify(value) === JSON.stringify(defaultPropValues[node.type][prop]))
				&& !readOnlyProps.includes(prop)
				&& !textProps.includes(prop)
				&& !styleProps.includes(prop)
				&& !(value === figma.mixed) // TODO: Temporary fix, needs to apply coners if mixed value
			) {
				// Don't print x and y coordiantes if child of a group type node
				// if (!(groupProp && (prop === "x" || prop === "y"))) {
				// TODO: Could probably move the stringify function to str function
				staticPropsStr += `${Ref(node)}.${prop} = ${JSON.stringify(value)}\n`
				// }

			}

			// Not being used at the moment
			// if (callback?.readonly) callback.readonly(prop, JSON.stringify(value))
			// if (callback?.writable) callback.writable(prop, JSON.stringify(value))
		}


	}



	var loadFontsString = "";

	if (hasText) {
		loadFontsString = `\
loadFonts().then(
	(res) => {
		${fontsString}
${textPropsString}
	}
)\n`
	}

	string += `
${staticPropsStr}\n`
	string += `${loadFontsString}\n`

	return string

}

function createProps(node, obj?, mainComponent?) {
	str`${walkProps(node, obj, mainComponent)}`
}

function appendNode(node) {

	// If parent is a group type node then append to nearest none group parent
	if (node.parent?.type === "BOOLEAN_OPERATION"
		|| node.parent?.type === "GROUP") {
		str`${Ref(findNoneGroupParent(node))}.appendChild(${Ref(node)})\n`
	}
	else if (node.parent?.type === "COMPONENT_SET") {
		// Currently set to do nothing, but should it append to something? Is there a way?
		// str`${Ref(findNoneGroupParent(node))}.appendChild(${Ref(node)})\n`
	}
	else {
		str`${Ref(node.parent)}.appendChild(${Ref(node)})\n`
	}


}

function createBasic(node) {

	if (node.type === "COMPONENT") {
		if (allComponents.some((component) => JSON.stringify(component) === JSON.stringify(node))) {
			return true
		}
	}

	if (node.type !== "GROUP"
		&& node.type !== "INSTANCE"
		&& node.type !== "COMPONENT_SET"
		&& node.type !== "BOOLEAN_OPERATION"
		&& !isNestedInstance(node)) {

		// TODO: Need to find a way to prevent objects being created for components that have already created by instances

		// If it's anything but a component then create the object
		if (node.type !== "COMPONENT") {
			str`
			
			// Create ${node.type}
var ${Ref(node)} = figma.create${v.titleCase(node.type)}()\n`
			createProps(node)


			appendNode(node)

		}

		// If it's a component first check if it's been added to the list before creating, if not then create it and add it to the list

		if (node.type === "COMPONENT") {

			if (!allComponents.some((component) => JSON.stringify(component) === JSON.stringify(node))) {
				str`
				
				// Create ${node.type}
var ${Ref(node)} = figma.create${v.titleCase(node.type)}()\n`
				createProps(node)


				appendNode(node)

				allComponents.push(node)
			}
		}

	}
}

function createInstance(node) {

	var mainComponent;

	if (node.type === "INSTANCE") {
		mainComponent = node.mainComponent
	}

	// If component doesn't exist in the document (as in it's in secret Figma location)
	if (node.type === "INSTANCE") {
		if (node.mainComponent.parent === null || !node.mainComponent) {
			// Create the component
			var temp = node.mainComponent.clone()
			mainComponent = temp
			// Add to nodes to discard at end
			discardNodes.push(temp)
		}
	}


	if (node.type === "INSTANCE" && !isNestedInstance(node)) {


		if (!allComponents.includes(mainComponent)) {
			createNode(mainComponent)
		}

		str`

		
// Create INSTANCE
var ${Ref(node)} = ${Ref(mainComponent)}.createInstance()\n`


		// Need to reference main component so that createProps can check if props are overriden
		createProps(node, null, mainComponent)

		appendNode(node)
	}



	// Once component has been created add it to array of all components
	if (node.type === "INSTANCE") {
		if (!allComponents.some((component) => JSON.stringify(component) === JSON.stringify(mainComponent))) {
			allComponents.push(mainComponent)
		}
	}

}

function createGroup(node) {
	if (node.type === "GROUP") {
		var children: any = Ref(node.children)
		if (Array.isArray(children)) {
			children = Ref(node.children).join(', ')
		}
		var parent
		if (node.parent?.type === "GROUP"
			|| node.parent?.type === "COMPONENT_SET"
			|| node.parent?.type === "BOOLEAN_OPERATION") {

			parent = `${Ref(findNoneGroupParent(node))}`
			// parent = `figma.currentPage`
		}
		else {
			parent = `${Ref(node.parent)}`
		}
		str`
		
		// Create GROUP
		var ${Ref(node)} = figma.group([${children}], ${parent})\n`
	}
}

function createBooleanOperation(node) {
	// Boolean can not be created if inside instance
	// TODO: When boolean objects are created they loose their coordinates?
	// TODO: Don't resize boolean objects
	if (node.type === "BOOLEAN_OPERATION"
		&& !isNestedInstance(node)) {
		var children: any = Ref(node.children)
		if (Array.isArray(children)) {
			children = Ref(node.children).join(', ')
		}
		var parent
		if (node.parent?.type === "GROUP"
			|| node.parent?.type === "COMPONENT_SET"
			|| node.parent?.type === "BOOLEAN_OPERATION") {
			parent = `${Ref(findNoneGroupParent(node))}`
		}
		else {
			parent = `${Ref(node.parent)}`
		}
		str`
		
		// Create BOOLEAN_OPERATION
		var ${Ref(node)} = figma.${v.lowerCase(node.booleanOperation)}([${children}], ${parent})\n`

		var x = node.parent.x - node.x;
		var y = node.parent.y - node.y;

		createProps(node, { resize: false })
		// str`${Ref(node)}.x = 0
		// ${Ref(node)}.y = 0`
	}
}

function createComponentSet(node, callback?) {
	// FIXME: What should happen when the parent is a group? The component set can't be added to a appended to a group. It therefore must be added to the currentPage, and then grouped by the group function?
	if (node.type === "COMPONENT_SET") {
		var children: any = Ref(node.children)
		if (Array.isArray(children)) {
			children = Ref(node.children).join(', ')
		}
		var parent
		if (node.parent?.type === "GROUP"
			|| node.parent?.type === "COMPONENT_SET"
			|| node.parent?.type === "BOOLEAN_OPERATION") {
			parent = `${Ref(findNoneGroupParent(node))}`
		}
		else {
			parent = `${Ref(node.parent)}`
		}


		str`
		
		// Create COMPONENT_SET
		var ${Ref(node)} = figma.combineAsVariants([${children}], ${parent})\n`

		createProps(node)
	}
}

function createNode(nodes) {
	nodes = putValuesIntoArray(nodes)
	walkNodes(nodes, {
		during(node, { ref, level, sel, parent }) {

			createInstance(node)
			return createBasic(node)
		},
		after(node, { ref, level, sel, parent }) {
			createGroup(node)
			createBooleanOperation(node)
			createComponentSet(node)
		}
	})
}

function main() {

	figma.showUI(__html__, { width: 320, height: 480 });

	var selection = figma.currentPage.selection

	// for (var i = 0; i < selection.length; i++) {
	createNode(selection)
	// }

	if (fonts) {
		str.prepend`
		async function loadFonts() {
			await Promise.all([
				${fonts.map((font) => {
			return `figma.loadFontAsync({
					family: ${JSON.stringify(font.family)},
					style: ${JSON.stringify(font.style)}
					})`
		})}
			])
		}\n`
	}

	// Remove nodes created for temporary purpose
	for (var i = 0; i < discardNodes.length; i++) {
		var node = discardNodes[i]
		node.remove()
	}

	var result = str().match(/(?=[\s\S])(?:.*\n?){1,8}/g)

	sendToUI({ type: 'string-received', value: result })

}


var successful;

figma.ui.onmessage = (res) => {
	if (res.type === "code-rendered") {
		successful = true
	}

	if (res.type === "code-copied") {
		figma.notify("Copied to clipboard")
	}
}


if (figma.currentPage.selection.length > 0) {
	main()

	setTimeout(function () {

		if (!successful) {
			figma.notify("Plugin timed out")
			figma.closePlugin()
		}
	}, 6000)
}
else {
	figma.notify("Select nodes to decode")
	figma.closePlugin()
}
