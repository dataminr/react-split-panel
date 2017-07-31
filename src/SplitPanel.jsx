import React from "react";
import PropTypes from "prop-types";
import classNames from "classnames";
import _ from "lodash";

/**
 * A container that lays out its children (henceforth referred to as
 * "subpanels") in resizeable rows or columns.
 *
 * Each subpanel is sized according to its weight, which is a fraction of the
 * sum over all weights. E.g., if you specify weights=[30,60,10] the subpanels
 * will receive 30%, 60% and 10% of the available space respectively. If you
 * then remove the first subpanel and weights=[60,10] the remaining subpanels
 * will receive approximately 86% and 14% of the available space.
 *
 * N.B. If you specify too few or too many weights a console warning will be
 * issued. If you specified too few the minimum weight specified is
 * used for all remaining elements. Any additional weights will be ignored.
 */
export default class SplitPanel extends React.Component {
  static propTypes = {
    /**
     * The direction to layout subpanels. One of "horizontal" or "vertical".
     *
     * Default: horizontal
     */
    direction: PropTypes.oneOf(["horizontal", "vertical"]),

    /**
     * The minimum size (in pixels) of a subpanel. The divider will stop
     * abruptly if the user attempts to shrink a subpanel below this size.
     *
     * Default: 25
     */
    minPanelSize: PropTypes.number,

    /**
     * Called whenever a subpanel is resized.
     *
     * You should update `weights` in response to this event unless you're
     * using `defaultWeights`.
     */
    onWeightChange: PropTypes.func,

    /**
     * The weights of each subpanel. If you're using this property you must
     * manually update this prop in response to `onWeightChange` otherwise
     * the subpanels will not resize.
     */
    weights: PropTypes.arrayOf(PropTypes.number),

    /**
     * The default weights to use when you are not managing the weights
     * manually via the `weights` and `onWeightChange` props.
     */
    defaultWeights: PropTypes.arrayOf(PropTypes.number),

    /**
     * The resize step size in pixels.
     *
     * Useful if you have monospaced text and you want to ensure the panel
     * is resized in increments of one character width.
     *
     * Default: 1
     */
    stepSize: PropTypes.number,

    /**
     * Bool that controls adjustment on mouse up functionality
     *
     * Used to adjust the weights after a fast mousemove by the user
     * Without it they may start to exceed the dimensions of the container
     *
     * Default: true
     */
    doAdjustmentOnMouseUp: PropTypes.bool,

    /**
     * Bool that controls exit on violation during mouse move functionality
     *
     * During the mouse move, if the minPanelSize is violated,
     * Don't go through with the state change
     *
     * Default: true
     */
    exitMouseMoveOnViolation: PropTypes.bool,

    /**
     * Bool that controls adjustment on componentWillReceiveProps
     *
     * Used to adjust the weights when getting new props
     *
     * Default: true
     */
    adjustOnReceiveProps: PropTypes.bool,

    /**
     * Bool that controls adjustment on mouse move functionality
     *
     * Used to adjust the weights during a fast mousemove by the user
     * Without it they may start to exceed the dimensions of the container
     * This one is a bit risky since the action is in the middle of happening
     * Optional and not recommended unless you're getting better results with it
     *
     * Default: false
     */
    doAdjustmentOnMouseMove: PropTypes.bool
  };

  static defaultProps = {
    direction: "horizontal",
    minPanelSize: 25,
    stepSize: 1,
    doAdjustmentOnMouseUp: true,
    exitMouseMoveOnViolation: true,
    adjustOnReceiveProps: true,
    doAdjustmentOnMouseMove: false
  };

  constructor() {
    super();

    this.state = {
      // The last position of the cursor. Used by onMouseMove to calculate
      // relative changes in divider position.
      lastCursorPosition: 0,
      // Sizes of the subpanels taking into account the weights and divider
      // size.
      sizes: [],
      // Offsets of each subpanel.
      offsets: [],
      // The index of the divider currently being dragged by the user.
      activeDividerIndex: -1,
    };

    // Bind event listeners in advance.
    this.onDividerMouseDown = this.onDividerMouseDown.bind(this);
    // These two are attached to `window` because sometimes due to glitches we
    // can't do very much about we'll be unable to move the divider in time to
    // keep up with the mouse cursor, but we still need to move the divider to
    // catch up and to release it when the user releases the divider.
    // N.B. These are attached in componentDidMount and detached in
    // componentWillUnmount.
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  render() {

    // Create a sized splitPanelItem with a divider for each child, except...
    const childrenWithDividers = [];
    const children = React.Children.toArray(this.props.children);
    for (let i = 0; i < children.length; i++) {
      const style = {
        [this.cssSizeProperty]: this.sizes[i],
        [this.cssOffsetProperty]: this.offsets[i],
      };

      childrenWithDividers.push(<div key={`panel-${i}`}
                                     className="split-panel-item"
                                     style={style}>{children[i]}</div>);

      // ...don't add a divider if it's the last panel.
      if (i < children.length - 1) {
        const dividerStyle = {
          [this.cssOffsetProperty]: this.offsets[i + 1] - this.dividerSize,
        };
        childrenWithDividers.push(<div
          key={`divider-${i}`} ref={`divider-${i}`}
          className="split-panel-divider"
          style={dividerStyle}
          onMouseDown={e => this.onDividerMouseDown(e, i)}>
        </div>);
      }
    }

    // Because elements don't have a resize event we create an <object> with
    // no content and filling the entire panel. When this object's
    // contentDocument.resize event fires we know to update the sizes of all
    // the subpanels. :-)
    const resizeHackObject = <object className="split-panel-resize-hack-object"
                                     ref="resizeHackObject"
                                     type="text/html">
    </object>;
    const klass = classNames("split-panel", this.props.direction, {
      "split-panel-resizing": this.state.activeDividerIndex != -1,
    });
    return <div ref="self" className={klass}>
      {resizeHackObject}
      {childrenWithDividers}
    </div>;
  }

  //////
  // Component Lifecycle
  //////
  componentWillReceiveProps(newProps) {
    //Make sure to call padOrTruncateWeights with the children from newProps,
    //Otherwise it'll check the old children and won't render properly until re-sized
    if (newProps.weights) {
      const weights = this.padOrTruncateWeights(newProps.weights, newProps.children);
      const adjustedWeights = this.props.adjustOnReceiveProps ? this.adjust(weights) : weights;
      this.updateSizes(adjustedWeights);
    }
  }

  componentDidMount() {
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    // We do this here because we can't guarantee that the event handler will be
    // added before data is assigned if we do it in the JSX.
    this.refs.resizeHackObject.addEventListener("load", () => this.onResizeHackObjectLoad());
    this.refs.resizeHackObject.data = "about:blank";
    this.updateSizes();
  }

  componentWillUnmount() {
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
  }

  //////
  // Properties
  //////
  /**
   * Gets the weights for each panel. This prefers this.props.weights, falling
   * through to this.state.weights then this.props.defaultWeights.
   *
   * An Error is thrown if no weights are specified.
   */
  get weights() {
    let weights = null;
    if (this.props.weights && this.props.weights.length) {
      weights = this.props.weights;
    }
    else if (this.state.weights && this.state.weights.length) {
      weights = this.state.weights;
    }
    else if (this.props.defaultWeights && this.props.defaultWeights.length) {
      weights = this.props.defaultWeights;
    }
    else {
      throw new Error("SplitPanel: You must set a 'weights' or 'defaultWeights' prop");
    }
    return this.padOrTruncateWeights(weights);
  }

  get cursorPositionProperty() {
    return this.props.direction == "horizontal" ? "clientX" : "clientY";
  }

  get cssSizeProperty() {
    return this.props.direction == "horizontal" ? "width" : "height";
  }

  get cssOffsetProperty() {
    return this.props.direction == "horizontal" ? "left" : "top";
  }

  get domSizeProperty() {
    return this.props.direction == "horizontal" ?
      "clientWidth" : "clientHeight";
  }

  get dividerSize() {
    // During the initial render we can't calculate this, so default to 5px.
    // A fresh render is forced after the component is mounted to it doesn't
    // matter.
    if (this.refs["divider-0"]) {
      return this.refs["divider-0"][this.domSizeProperty];
    }
    else {
      return 5;
    }
  }

  get sizes() {
    const numChildren = React.Children.count(this.props.children);
    if (this.state.sizes.length == numChildren) {
      return this.state.sizes;
    }
    else {
      // XXX: We can't calculate the sizes until the component has been rendered
      // at least once (so we can't just call this.updateSizes() here) because
      // we need to obtain the divider size from the DOM.
      // Instead we say that all the panels are at the minimum size and hope
      // the initial render occurs quickly. XXX: Extra XXX to emphasise how ugly
      // this is.
      return _.fill(new Array(numChildren), this.props.minPanelSize);
    }
  }

  get offsets() {
    const numChildren = React.Children.count(this.props.children);
    if (this.state.offsets.length == numChildren) {
      return this.state.offsets;
    }
    else {
      // See the comment in `get sizes()`. The same applies here.
      return _.fill(new Array(numChildren), 0);
    }
  }

  //////
  // Event Handlers
  //////
  onResizeHackObjectLoad() {
    this.refs.resizeHackObject.contentDocument.defaultView.addEventListener(
      "resize", () => this.updateSizes());
  }

  onDividerMouseDown(e, dividerIndex) {
    const newState = {
      activeDividerIndex: dividerIndex,
      lastCursorPosition: e[this.cursorPositionProperty],
    };
    this.setState(newState);
  }

  onMouseUp() {
    //Adjust any messed up state at this point
    //So they can drag around as much as they want, and state will get out of whack
    //But as soon as they let go it'll fix itself
    const mouseIsDown = this.state.activeDividerIndex !== -1;
    const weights = this.weights;
    if (mouseIsDown && this.props.doAdjustmentOnMouseUp && weights) {
      const adjustedWeights = this.adjust(weights);
      this.emitWeightChange(adjustedWeights);
    }

    this.setState({ activeDividerIndex: -1 });
  }

  onMouseMove(e) {
    if (this.state.activeDividerIndex == -1) return;

    // The default mousemove action may highlight text inside the panes
    // If we're not dragging the divider, we don't want to prevent default, b/c we might actually be attempting to highlight text
    // But if that's the case, we don't get to this point (see above; this function returns if the drag is not on a divider)
    // If we are dragging the divider, then we want to prevent the highlight event from firing
    e.preventDefault();

    // If moving backwards (left or up) grow the next panel by taking space
    // from the previous one. If moving forwards (right or down) grow the
    // previous panel by taking space from the next.
    //
    // Horizontal: <previous>|<next>
    // Vertical:
    //  <previous>
    //  ----------
    //  <next>
    const prevIndex = this.state.activeDividerIndex;
    const nextIndex = prevIndex + 1;
    // First obtain the size difference, rounding it down to a multiple of
    // the step size...
    const diff = e[this.cursorPositionProperty] - this.state.lastCursorPosition;
    const steppedDiff = (diff / this.props.stepSize | 0) * this.props.stepSize;
    if (steppedDiff == 0) {
      // No change.
      return;
    }
    // ...then make it proportional to the total weight rather than the
    // container size.
    const weights = this.weights;
    const weightDiff = steppedDiff / this.refs.self[this.domSizeProperty] * _.sum(weights);

    // handle the case where minPanelSize is respected for the small panel, but its neighbor grows (it shouldn't)
    const weightPrev = weights[prevIndex];
    const weightNext = weights[nextIndex];
    const minWeight = this.pxToWeight(weights, this.props.minPanelSize);

    function weightViolated(weight, minWeight, directionIsWrong) {
      return (weight <= minWeight) && directionIsWrong;
    }

    //the previous weight is violated when it's too small, and we're moving in the negative direction, so it's getting smaller
    const prevWeightViolated = weightViolated(weightPrev, minWeight, weightDiff < 0);

    //the next weight is violated when it's too small, and we're moving in the positive direction, so it's getting smaller
    const nextWeightViolated = weightViolated(weightNext, minWeight, weightDiff > 0);

    // console.log("prevWeightViolated", prevWeightViolated);
    // console.log("nextWeightViolated", nextWeightViolated);

    if (this.props.exitMouseMoveOnViolation && (prevWeightViolated || nextWeightViolated)) {
      return;
    }

    // If weightDiff is negative we're moving backwards, so this will shrink
    // <previous> and grow <next>. Otherwise, we're moving forwards and
    // <previous> will grow while <next> shrinks.
    weights[prevIndex] += weightDiff;
    weights[nextIndex] -= weightDiff;

    if (this.props.doAdjustmentOnMouseMove) {
      const adjustedWeights = this.adjust(weights);
      this.emitWeightChange(adjustedWeights);
    } else {
      this.emitWeightChange(weights);
    }
    const newState = {
      // We subtract the portion of the difference that we discarded to avoid
      // accumulating rounding errors resulting in the cursor and divider
      // positions drifting apart.
      lastCursorPosition: e[this.cursorPositionProperty] - (diff - steppedDiff)
    };
    this.setState(newState);
  }

  //////
  // Event Emitters
  //////
  emitWeightChange(newWeights) {
    // Only set weights on the state if we don't expect the parent to
    // accept/reject the new weights by updating this.props.weights.
    if (this.props.defaultWeights && this.props.defaultWeights.length) {
      this.setState({ weights: newWeights }, () => this.updateSizes());
    }
    // Notify the parent that we'd like to change the weights.
    if (this.props.onWeightChange) {
      this.props.onWeightChange(newWeights);
    }
  }

  //////
  // Utilities
  //////


  /**
   * Return a new array of sizes with the adjustment made
   * The adjustment is to subtract adjustmentNeeded from the largest size in the array
   *
   * @param originalSizes
   * @param adjustmentNeeded
   */
  adjustMaxDown(originalSizes, adjustmentNeeded) {
    const sizes = _.clone(originalSizes);
    let maxIndex = 0;
    let maxPanelSize = sizes[0];
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] > maxPanelSize) {
        maxPanelSize = sizes[i];
        maxIndex = i;
      }
    }
    sizes[maxIndex] -= adjustmentNeeded;
    return sizes;
  }

  /**
   * Return a new array of sizes with the adjustment made
   * The adjustment is to add adjustmentNeeded to the smallest size in the array
   *
   * @param originalSizes
   * @param adjustmentNeeded
   */
  adjustMinUp(originalSizes, adjustmentNeeded) {
    const sizes = _.clone(originalSizes);
    let minIndex = 0;
    let minPanelSize = sizes[0];
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] < minPanelSize) {
        minPanelSize = sizes[i];
        minIndex = i;
      }
    }
    sizes[minIndex] += adjustmentNeeded;
    return sizes;
  }

  /**
   * Adjust the weights based on the expected sizes in pixels and the dom container size
   * When the user moves the divider quickly, the weights get bigger/smaller than they should
   * This is how we adjust to respect minPanelSize and the dom container size
   *
   * @param weights
   * @returns {*}
   */
  adjust(weights) {
    const sizesAndOffsets = this.calcSizesAndOffsets(weights);
    const sizes = sizesAndOffsets.sizes;
    // const offsets = sizesAndOffsets.offsets;
    const sumOfSizes = _.sum(sizes);
    const domContainerSize = this.refs.self[this.domSizeProperty];
    const expectedSumOfSizes = domContainerSize - this.dividerSize * (weights.length - 1);
    const diff = sumOfSizes - expectedSumOfSizes;

    if (diff > 0) {
      // console.log("Adjusting: sumOfSizes is " + diff + " higher than expectedSumOfSizes");
      const adjustedSizes = this.adjustMaxDown(sizes, diff);
      return _.map(adjustedSizes, (size) => {
        return size / expectedSumOfSizes * 100;
      });
    } else if (diff < 0) {
      const absDiff = -diff;
      // console.log("Adjusting: sumOfSizes is " + absDiff + " lower than expectedSumOfSizes");
      const adjustedSizes = this.adjustMinUp(sizes, absDiff);
      return _.map(adjustedSizes, (size) => {
        return size / expectedSumOfSizes * 100;
      });
    }

    return weights;
  }

  /**
   * Return the amount of pixels this panel should take up
   * Take into account the number of weights, and the space that the dividers take up
   *
   * Example
   *   There are 4 weights, and the current one is 27%
   *   The container is 1000px, and the dividers are 5px
   *   4 weights means 3 dividers. The total space they take up is then 15px
   *   The total amount of pixels that the panels themselves can take up is 1000px - 15px = 985px
   *   27% of 985px is 265.95px
   *
   * @param weights
   * @param index
   * @returns {number}
   */
  weightToPx(weights, index) {
    // Should always be 100, todo consider validating here
    const totalWeight = _.sum(weights);

    // The current weight's proportion of the entire container (so 27% becomes 0.27)
    const proportion = weights[index] / totalWeight;

    const totalSpaceTakenByDividers = this.dividerSize * (weights.length - 1);

    const spaceLeftForPanels = this.refs.self[this.domSizeProperty] - totalSpaceTakenByDividers;

    return proportion * spaceLeftForPanels;
  }

  /**
   * Return the weight that this amount of pixels corresponds to
   *
   * @param weights
   * @param pixels
   * @returns {number}
   */
  pxToWeight(weights, pixels) {
    const totalSpaceTakenByDividers = this.dividerSize * (weights.length - 1);

    const spaceLeftForPanels = this.refs.self[this.domSizeProperty] - totalSpaceTakenByDividers;

    return (100 * pixels) / spaceLeftForPanels;
  }

  /**
   * Calculate the precise sizes and offsets using the desired weights, the dom container size,
   * and the size taken up by the dividers
   *
   * @param weights
   * @returns {{sizes: Array, offsets: Array}}
   */
  calcSizesAndOffsets(weights) {
    weights = weights || this.weights;
    const offsets = [];
    const sizes = [];
    for (let i = 0; i < weights.length; i++) {
      const totalDividerSizeSoFar = i * this.dividerSize;
      const sizeInPx = this.weightToPx(weights, i);
      offsets.push(i === 0 ? 0 : (_.sum(sizes) + totalDividerSizeSoFar));
      sizes.push(Math.max(sizeInPx, this.props.minPanelSize));
    }
    return { sizes: sizes, offsets: offsets };
  }

  /**
   * Recalculates the size of each panel according to the weights, taking into
   * account the space used by the dividers then updates this.state.sizes
   * and this.state.offsets.
   */
  updateSizes(weights) {
    const sizesAndOffsets = this.calcSizesAndOffsets(weights);
    this.setState(sizesAndOffsets);
  }

  /**
   * Make up for too few or too many child elements by padding or truncating the weights
   * Return a new array of weights
   *
   * @param originalWeights
   * @returns {*}
   */
  padOrTruncateWeights(originalWeights, children = this.props.children) {
    const weights = _.clone(originalWeights);
    const numChildren = React.Children.count(children);
    if (weights.length < numChildren) {
      const minWeight = this.pxToWeight(weights, this.props.minPanelSize);
      console.warn(`SplitPanel: Only ${weights.length} weights specified ` +
        `but there are ${numChildren} subpanels; using ${minWeight} for the ` +
        `remaining subpanels`);
      while (weights.length < numChildren) {
        weights.push(minWeight);
      }
      return weights;
    } else if (weights.length > numChildren) {
      console.warn(`SplitPanel: ${weights.length} weights specified but ` +
        `there are only ${numChildren} subpanels; ignoring additional weights`);
      return weights.splice(0, numChildren);
    }
    return weights;
  }
}